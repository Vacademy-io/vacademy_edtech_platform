package vacademy.io.admin_core_service.features.product_page.job;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.course_catalogue.enums.CatalogueStatusEnum;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository;
import vacademy.io.admin_core_service.features.course_catalogue.repository.CatalogueInstituteMappingRepository.SiteCatalogueRow;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageCatalogueSyncResponse;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.product_page.service.ProductPageCatalogueSyncService;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Keeps every site cart's STORE product page in step with its institute's
 * catalogue, so a course version created in the admin can be added to the
 * cart without anyone pressing "Sync all catalogue courses".
 *
 * <p>A site with the cart on (catalogue_json {@code globalSettings.siteCart}
 * {@code enabled: true} and a {@code storeProductPageCode}) only offers "Add to
 * cart" for versions its store page sells, and the store was only updated by
 * that button: on 2026-10-14 Brahm Varchas created ~36 versions and none could
 * be bought until it was pressed.
 *
 * <p>Each run finds those sites and runs the same catalogue sync the button does
 * (deactivateMissing on, as the button defaults to on a store page), through
 * {@link ProductPageCatalogueSyncService#syncCatalogueAsSystem}. Nothing here
 * changes the sync's rules (CatalogueSyncPlanner): only sellable default-invite
 * versions are added, rows already on the page are never changed, the page's
 * gateway and currency rules hold, and a page is never emptied.
 *
 * <p>A site opts out with {@code siteCart.autoSync: false} (missing means on);
 * the whole job with {@code site-cart.auto-sync.enabled=false}.
 */
@Slf4j
@Component
public class SiteCartStoreAutoSyncJob {

    /** The statuses the public by-tag endpoint serves a site in (CourseCatalogueService). */
    static final List<String> LIVE_CATALOGUE_STATUSES =
            List.of(CatalogueStatusEnum.ACTIVE.name(), CatalogueStatusEnum.DRAFT.name());

    static final String JSON_PREFILTER = "%siteCart%";

    private static final String STATUS_DELETED = "DELETED";

    private final CatalogueInstituteMappingRepository catalogueMappingRepository;
    private final ProductPageRepository productPageRepository;
    private final ProductPageCatalogueSyncService syncService;
    private final ObjectMapper objectMapper;
    private final boolean enabled;

    public SiteCartStoreAutoSyncJob(CatalogueInstituteMappingRepository catalogueMappingRepository,
                                    ProductPageRepository productPageRepository,
                                    ProductPageCatalogueSyncService syncService,
                                    ObjectMapper objectMapper,
                                    @Value("${site-cart.auto-sync.enabled:true}") boolean enabled) {
        this.catalogueMappingRepository = catalogueMappingRepository;
        this.productPageRepository = productPageRepository;
        this.syncService = syncService;
        this.objectMapper = objectMapper;
        this.enabled = enabled;
    }

    /** What one run did. */
    public record RunResult(int stores, int changed, int failed, int skipped) {
        static final RunResult DISABLED = new RunResult(0, 0, 0, 0);
    }

    /** A store page to sync and the sites (catalogue tags) that use it. */
    record Store(String instituteId, String productPageId, String productPageCode, List<String> tags) {
    }

    @Scheduled(fixedDelayString = "${site-cart.auto-sync.delay-ms:300000}",
            initialDelayString = "${site-cart.auto-sync.initial-delay-ms:120000}")
    @SchedulerLock(name = "SiteCartStoreAutoSyncJob", lockAtMostFor = "PT15M", lockAtLeastFor = "PT1M")
    public void run() {
        runOnce();
    }

    /**
     * One pass over every site-cart store. Deliberately not {@code @Transactional}:
     * each store's sync is its own transaction inside the service, so a failure on
     * one store cannot roll back the others, and no connection is held across the
     * whole pass.
     */
    public RunResult runOnce() {
        if (!enabled) {
            log.debug("[SiteCart] Store auto sync is switched off (site-cart.auto-sync.enabled=false)");
            return RunResult.DISABLED;
        }

        Discovery discovery = discoverStores();
        int changed = 0;
        int failed = 0;
        for (Store store : discovery.stores()) {
            try {
                ProductPageCatalogueSyncResponse res =
                        syncService.syncCatalogueAsSystem(store.productPageId(), store.instituteId(), true);
                if (res.getAdded() > 0 || res.getDeactivated() > 0) {
                    changed++;
                    log.info("[SiteCart] Store {} ({}) of institute {} for site(s) {}: {} added, {} deactivated, "
                                    + "{} skipped",
                            store.productPageCode(), store.productPageId(), store.instituteId(), store.tags(),
                            res.getAdded(), res.getDeactivated(), res.getSkipped().size());
                } else {
                    log.debug("[SiteCart] Store {} ({}) of institute {} already in step",
                            store.productPageCode(), store.productPageId(), store.instituteId());
                }
            } catch (Exception e) {
                // One store's bad data or failed write must not end the pass.
                failed++;
                log.error("[SiteCart] Store auto sync failed for page {} ({}) of institute {}: {}",
                        store.productPageCode(), store.productPageId(), store.instituteId(), e.getMessage(), e);
            }
        }

        RunResult result = new RunResult(discovery.stores().size(), changed, failed, discovery.skipped());
        if (changed > 0 || failed > 0 || discovery.skipped() > 0) {
            log.info("[SiteCart] Store auto sync: {} store(s), {} changed, {} failed, {} site(s) skipped",
                    result.stores(), result.changed(), result.failed(), result.skipped());
        } else {
            log.debug("[SiteCart] Store auto sync: {} store(s), nothing to change", result.stores());
        }
        return result;
    }

    record Discovery(List<Store> stores, int skipped) {
    }

    /**
     * Sites with the cart on and auto sync not turned off, resolved to their store
     * pages: one entry per (institute, page), whatever number of sites share it.
     * {@code skipped} counts sites whose store could not be resolved.
     */
    Discovery discoverStores() {
        List<SiteCatalogueRow> rows =
                catalogueMappingRepository.findSiteCataloguesWithJsonLike(LIVE_CATALOGUE_STATUSES, JSON_PREFILTER);
        Map<String, Store> stores = new LinkedHashMap<>();
        Map<String, Optional<ProductPage>> pagesByCode = new LinkedHashMap<>();
        int skipped = 0;
        for (SiteCatalogueRow row : rows) {
            String code = autoSyncStoreCode(row.getCatalogueJson());
            if (code == null || row.getInstituteId() == null) {
                continue;
            }
            ProductPage page = pagesByCode.computeIfAbsent(code, productPageRepository::findByCode).orElse(null);
            if (page == null || !row.getInstituteId().equals(page.getInstituteId())
                    || STATUS_DELETED.equals(page.getStatus())) {
                skipped++;
                log.warn("[SiteCart] Site {} (catalogue {}, institute {}) names store page {}, which {}; not synced",
                        row.getTagName(), row.getCatalogueId(), row.getInstituteId(), code,
                        page == null ? "does not exist"
                                : STATUS_DELETED.equals(page.getStatus()) ? "is deleted"
                                : "belongs to another institute");
                continue;
            }
            String key = row.getInstituteId() + "|" + page.getId();
            Store store = stores.computeIfAbsent(key,
                    k -> new Store(row.getInstituteId(), page.getId(), page.getCode(), new ArrayList<>()));
            store.tags().add(row.getTagName());
        }
        return new Discovery(new ArrayList<>(stores.values()), skipped);
    }

    /**
     * The store page code of a site whose cart is on and kept in step
     * automatically: {@code globalSettings.siteCart} with {@code enabled: true},
     * a non-blank {@code storeProductPageCode} and {@code autoSync} not
     * {@code false}. Null otherwise, including for JSON that does not parse.
     */
    String autoSyncStoreCode(String catalogueJson) {
        if (catalogueJson == null || catalogueJson.isBlank()) return null;
        JsonNode root;
        try {
            root = objectMapper.readTree(catalogueJson);
        } catch (Exception e) {
            return null;
        }
        JsonNode cart = root == null ? null : root.path("globalSettings").path("siteCart");
        if (cart == null || !cart.isObject()) return null;
        JsonNode on = cart.get("enabled");
        if (on == null || !on.isBoolean() || !on.booleanValue()) return null;
        JsonNode auto = cart.get("autoSync");
        if (auto != null && auto.isBoolean() && !auto.booleanValue()) return null;
        JsonNode code = cart.get("storeProductPageCode");
        if (code == null || !code.isTextual() || code.asText().isBlank()) return null;
        return code.asText().trim();
    }
}
