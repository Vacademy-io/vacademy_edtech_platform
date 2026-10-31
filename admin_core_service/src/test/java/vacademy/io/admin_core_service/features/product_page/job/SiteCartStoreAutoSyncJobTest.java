package vacademy.io.admin_core_service.features.product_page.job;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository.SiteCatalogueRow;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageCatalogueSyncResponse;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageCatalogueSyncService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The sweep that keeps each site cart's store product page in step with the
 * catalogue: which sites it finds, which store pages it will touch, and that
 * one store's failure leaves the others synced.
 */
class SiteCartStoreAutoSyncJobTest {

    private static final String INST = "inst-1";
    private static final String OTHER_INST = "inst-2";

    private CatalogueInstituteMappingRepository catalogueRepo;
    private ProductPageRepository pageRepo;
    private ProductPageCatalogueSyncService syncService;
    private SiteCartStoreAutoSyncJob job;
    private final List<SiteCatalogueRow> rows = new ArrayList<>();
    private final Map<String, ProductPage> pages = new HashMap<>();

    @BeforeEach
    void setUp() {
        catalogueRepo = Mockito.mock(CatalogueInstituteMappingRepository.class);
        pageRepo = Mockito.mock(ProductPageRepository.class);
        syncService = Mockito.mock(ProductPageCatalogueSyncService.class);
        job = newJob(true);
        when(catalogueRepo.findSiteCataloguesWithJsonLike(anyList(), anyString())).thenAnswer(i -> rows);
        when(pageRepo.findByCode(anyString())).thenAnswer(i -> Optional.ofNullable(pages.get(i.<String>getArgument(0))));
        when(syncService.syncCatalogueAsSystem(anyString(), anyString(), anyBoolean()))
                .thenAnswer(i -> response(0, 0));
    }

    private SiteCartStoreAutoSyncJob newJob(boolean enabled) {
        return new SiteCartStoreAutoSyncJob(catalogueRepo, pageRepo, syncService, new ObjectMapper(), enabled);
    }

    private static ProductPageCatalogueSyncResponse response(int added, int deactivated) {
        ProductPageCatalogueSyncResponse res = new ProductPageCatalogueSyncResponse();
        res.setAdded(added);
        res.setDeactivated(deactivated);
        return res;
    }

    private void site(String tag, String instituteId, String json) {
        rows.add(new SiteCatalogueRow() {
            public String getCatalogueId() { return "cat-" + tag; }
            public String getInstituteId() { return instituteId; }
            public String getTagName() { return tag; }
            public String getCatalogueJson() { return json; }
        });
    }

    private static String cart(String cartJson) {
        return "{\"pages\":[],\"globalSettings\":{\"theme\":{},\"siteCart\":" + cartJson + "}}";
    }

    private void page(String id, String code, String instituteId, String status) {
        ProductPage p = new ProductPage();
        p.setId(id);
        p.setCode(code);
        p.setInstituteId(instituteId);
        p.setStatus(status);
        p.setName(code);
        pages.put(code, p);
    }

    @Test
    @DisplayName("reads only live catalogues mentioning siteCart: ACTIVE and DRAFT, as the public by-tag endpoint")
    void discoveryQuery() {
        job.runOnce();
        verify(catalogueRepo).findSiteCataloguesWithJsonLike(List.of("ACTIVE", "DRAFT"), "%siteCart%");
    }

    @Test
    @DisplayName("parses the site cart: on, a store code, autoSync not false (missing = on)")
    void parsing() {
        assertEquals("store", job.autoSyncStoreCode(cart("{\"enabled\":true,\"storeProductPageCode\":\"store\"}")));
        assertEquals("store", job.autoSyncStoreCode(
                cart("{\"enabled\":true,\"storeProductPageCode\":\" store \",\"autoSync\":true}")));
        assertEquals("store", job.autoSyncStoreCode(
                cart("{\"enabled\":true,\"storeProductPageCode\":\"store\",\"storeProductPageName\":\"S\","
                        + "\"somethingNew\":1}")));
        assertNull(job.autoSyncStoreCode(cart("{\"enabled\":false,\"storeProductPageCode\":\"store\"}")));
        assertNull(job.autoSyncStoreCode(cart("{\"storeProductPageCode\":\"store\"}")));
        assertNull(job.autoSyncStoreCode(cart("{\"enabled\":\"true\",\"storeProductPageCode\":\"store\"}")));
        assertNull(job.autoSyncStoreCode(
                cart("{\"enabled\":true,\"storeProductPageCode\":\"store\",\"autoSync\":false}")));
        assertNull(job.autoSyncStoreCode(cart("{\"enabled\":true,\"storeProductPageCode\":\"  \"}")));
        assertNull(job.autoSyncStoreCode(cart("{\"enabled\":true}")));
        assertNull(job.autoSyncStoreCode(cart("null")));
        assertNull(job.autoSyncStoreCode("{\"siteCart\":{\"enabled\":true,\"storeProductPageCode\":\"store\"}}"),
                "siteCart only counts under globalSettings");
        assertNull(job.autoSyncStoreCode("{\"globalSettings\": {\"siteCart\": {\"enabled\": tr"));
        assertNull(job.autoSyncStoreCode("[]"));
        assertNull(job.autoSyncStoreCode(""));
        assertNull(job.autoSyncStoreCode(null));
    }

    @Test
    @DisplayName("syncs each resolvable store once, as the system, switching off what left the catalogue")
    void syncsResolvableStores() {
        page("pp-1", "store", INST, "ACTIVE");
        page("pp-2", "draft-store", OTHER_INST, "DRAFT");
        page("pp-x", "theirs", OTHER_INST, "ACTIVE");
        page("pp-d", "gone", INST, "DELETED");
        site("main", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"store\"}"));
        // A second site of the same institute sharing the store: synced once.
        site("hindi", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"store\",\"autoSync\":true}"));
        site("other", OTHER_INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"draft-store\"}"));
        site("off", INST, cart("{\"enabled\":false,\"storeProductPageCode\":\"store\"}"));
        site("manual", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"store\",\"autoSync\":false}"));
        site("blank", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"\"}"));
        site("broken", INST, "{not json siteCart");
        site("foreign", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"theirs\"}"));
        site("deleted", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"gone\"}"));
        site("missing", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"nope\"}"));

        SiteCartStoreAutoSyncJob.RunResult result = job.runOnce();

        verify(syncService, times(1)).syncCatalogueAsSystem("pp-1", INST, true);
        verify(syncService, times(1)).syncCatalogueAsSystem("pp-2", OTHER_INST, true);
        verify(syncService, never()).syncCatalogueAsSystem("pp-x", INST, true);
        verify(syncService, never()).syncCatalogueAsSystem("pp-x", OTHER_INST, true);
        verify(syncService, never()).syncCatalogueAsSystem(org.mockito.ArgumentMatchers.eq("pp-d"), anyString(),
                anyBoolean());
        verify(syncService, times(2)).syncCatalogueAsSystem(anyString(), anyString(), anyBoolean());
        assertEquals(2, result.stores());
        assertEquals(0, result.changed());
        assertEquals(0, result.failed());
        assertEquals(3, result.skipped(), "foreign, deleted and missing store pages");
        // Each code is looked up once per pass.
        verify(pageRepo, times(1)).findByCode("store");

        SiteCartStoreAutoSyncJob.Discovery discovery = job.discoverStores();
        assertEquals(List.of("main", "hindi"), discovery.stores().get(0).tags());
    }

    @Test
    @DisplayName("one store's failure is logged and the others are still synced")
    void failureIsolation() {
        page("pp-1", "a", INST, "ACTIVE");
        page("pp-2", "b", OTHER_INST, "ACTIVE");
        page("pp-3", "c", "inst-3", "ACTIVE");
        site("a", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"a\"}"));
        site("b", OTHER_INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"b\"}"));
        site("c", "inst-3", cart("{\"enabled\":true,\"storeProductPageCode\":\"c\"}"));
        when(syncService.syncCatalogueAsSystem("pp-1", INST, true)).thenAnswer(i -> response(36, 0));
        when(syncService.syncCatalogueAsSystem("pp-2", OTHER_INST, true))
                .thenThrow(new VacademyException("Product page not found"));
        when(syncService.syncCatalogueAsSystem("pp-3", "inst-3", true)).thenAnswer(i -> response(0, 2));

        SiteCartStoreAutoSyncJob.RunResult result = job.runOnce();

        verify(syncService).syncCatalogueAsSystem("pp-3", "inst-3", true);
        assertEquals(3, result.stores());
        assertEquals(2, result.changed());
        assertEquals(1, result.failed());
        assertEquals(0, result.skipped());
    }

    @Test
    @DisplayName("the kill switch stops the pass before it reads anything")
    void killSwitch() {
        page("pp-1", "store", INST, "ACTIVE");
        site("main", INST, cart("{\"enabled\":true,\"storeProductPageCode\":\"store\"}"));

        SiteCartStoreAutoSyncJob.RunResult result = newJob(false).runOnce();

        assertEquals(new SiteCartStoreAutoSyncJob.RunResult(0, 0, 0, 0), result);
        verifyNoInteractions(catalogueRepo, pageRepo, syncService);
    }

    @Test
    @DisplayName("no site with a cart: nothing is synced")
    void nothingToDo() {
        SiteCartStoreAutoSyncJob.RunResult result = job.runOnce();
        assertEquals(0, result.stores());
        verifyNoInteractions(syncService);
    }
}
