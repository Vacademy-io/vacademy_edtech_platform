package vacademy.io.admin_core_service.features.product_page.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.level.enums.LevelStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageSessionStatusEnum;
import vacademy.io.admin_core_service.features.packages.enums.PackageStatusEnum;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageCatalogueSessionRow;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageCatalogueSyncResponse;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageCatalogueRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Fills a product page with every course version the institute's catalogue
 * sells, so one "store" page can check out anything the site's Courses page
 * shows - through each course's own open default enrollment link and its
 * price, on one payment gateway and in one currency.
 *
 * Unlike PUT /update, which soft-deletes every mapping and re-inserts the
 * list it is sent, the sync only appends what is missing and switches off
 * what can no longer be sold: mappings the page already has keep their ids,
 * plans, order and flags. CatalogueSyncPlanner holds the rules.
 */
@Slf4j
@Service
public class ProductPageCatalogueSyncService {

    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final String STATUS_INACTIVE = "INACTIVE";
    private static final String STATUS_DELETED = "DELETED";

    @Autowired
    private ProductPageRepository productPageRepository;

    @Autowired
    private ProductPageInviteMappingRepository mappingRepository;

    @Autowired
    private ProductPageCatalogueRepository catalogueRepository;

    @Autowired
    private PackageSessionLearnerInvitationToPaymentOptionRepository bridgeRepository;

    @Autowired
    private ProductPageService productPageService;

    @Autowired
    private InstituteAccessValidator accessValidator;

    /**
     * The most mappings one auto sync may switch off when it would switch off more
     * than it adds. That shape is far likelier a store filled by other means
     * (copied from other pages, or courses not published to the catalogue) or a
     * catalogue that came back short than courses leaving it, so the auto sync
     * then only adds and leaves the switching off to an admin's manual sync,
     * which shows what would go. A restructure that replaces versions (as many
     * added as switched off, or more) is not held back.
     */
    @Value("${site-cart.auto-sync.max-deactivations:20}")
    private int maxAutoDeactivations = 20;

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * @param deactivateMissing also switch off mappings whose session left the
     *                          catalogue or can no longer be sold (see the planner)
     */
    @Transactional
    public ProductPageCatalogueSyncResponse syncCatalogue(CustomUserDetails user, String productPageId,
                                                          String instituteId, boolean deactivateMissing) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        return sync(productPageId, instituteId, deactivateMissing, false);
    }

    /**
     * {@link #syncCatalogue} with no user behind it, for SiteCartStoreAutoSyncJob:
     * the caller has already resolved the page to the institute whose site
     * names it as its store. Same lock, same planner, same rules; only the
     * admin check is left out, and the response carries the page's id and
     * code and the sync summary, not the page body.
     */
    @Transactional
    public ProductPageCatalogueSyncResponse syncCatalogueAsSystem(String productPageId, String instituteId,
                                                                  boolean deactivateMissing) {
        return sync(productPageId, instituteId, deactivateMissing, true);
    }

    private ProductPageCatalogueSyncResponse sync(String productPageId, String instituteId,
                                                  boolean deactivateMissing, boolean auto) {
        if (!StringUtils.hasText(productPageId)) {
            throw new VacademyException("productPageId is required");
        }
        // Locked like the editor's save, so a save and a sync never interleave.
        // The institute is part of the locking query, so another institute's
        // page is never locked: it reads as missing rather than forbidden.
        ProductPage page = productPageRepository.lockByIdAndInstituteId(productPageId.trim(), instituteId)
                .filter(p -> !STATUS_DELETED.equals(p.getStatus()))
                .orElseThrow(() -> new VacademyException("Product page not found"));

        List<ProductPageInviteMapping> active = productPageService.activeMappings(page.getId());
        Map<String, PaymentPlan> plans = productPageService.loadPlans(active);
        List<CatalogueSyncPlanner.Row> rows = new ArrayList<>();
        for (ProductPageInviteMapping mapping : active) {
            rows.add(toRow(mapping, plans));
        }
        List<CatalogueSyncPlanner.Pick> picks = new ArrayList<>();
        for (ProductPageCatalogueSessionRow row : catalogueRepository.findCatalogueSessions(
                instituteId,
                List.of(PackageStatusEnum.ACTIVE.name()),
                List.of(PackageSessionStatusEnum.ACTIVE.name(), PackageSessionStatusEnum.HIDDEN.name()),
                List.of(LevelStatusEnum.ACTIVE.name()),
                STATUS_ACTIVE)) {
            picks.add(toPick(row));
        }

        CatalogueSyncPlanner.Plan plan = CatalogueSyncPlanner.plan(rows, picks, deactivateMissing);
        String guardWarning = null;
        // A restructure (new versions replacing old ones) adds at least as many as it
        // switches off; a store filled by other means, or a catalogue that came back
        // short, switches off far more than it adds. Only the second is held back.
        if (auto && plan.deactivations().size() > maxAutoDeactivations
                && plan.deactivations().size() > plan.adds().size()) {
            guardWarning = "The auto sync would have switched off " + plan.deactivations().size()
                    + " courses on this page (more than " + maxAutoDeactivations
                    + "), so it only added courses. Run the sync by hand to switch them off.";
            log.warn("Catalogue auto sync of product page {} (institute {}) would switch off {} mappings "
                            + "(limit {}); adding only", page.getId(), instituteId,
                    plan.deactivations().size(), maxAutoDeactivations);
            plan = CatalogueSyncPlanner.plan(rows, picks, false);
        }

        Map<String, ProductPageInviteMapping> byId = new HashMap<>();
        for (ProductPageInviteMapping mapping : active) byId.put(mapping.getId(), mapping);
        List<ProductPageInviteMapping> changed = new ArrayList<>();
        for (CatalogueSyncPlanner.Deactivation d : plan.deactivations()) {
            ProductPageInviteMapping mapping = byId.get(d.row().mappingId());
            mapping.setStatus(STATUS_INACTIVE);
            changed.add(mapping);
        }
        for (CatalogueSyncPlanner.Add add : plan.adds()) {
            ProductPageInviteMapping mapping = new ProductPageInviteMapping();
            mapping.setProductPage(page);
            mapping.setPsInvitePaymentOption(bridgeRepository.getReferenceById(add.pick().psliId()));
            mapping.setPaymentPlanId(add.pick().paymentPlanId());
            // Never preselected: on a store page that would put the course in
            // every visitor's cart.
            mapping.setPreselected(false);
            mapping.setDisplayOrder(add.displayOrder());
            mapping.setStatus(STATUS_ACTIVE);
            changed.add(mapping);
        }

        if (!changed.isEmpty()) {
            mappingRepository.saveAll(changed);
            mappingRepository.flush();
        }

        ProductPageCatalogueSyncResponse response = new ProductPageCatalogueSyncResponse();
        if (!auto) {
            List<ProductPageInviteMapping> after = active;
            if (!changed.isEmpty()) {
                // Re-read the page's rows from the database: the new ones hold
                // bridge references that were never loaded.
                entityManager.clear();
                after = productPageService.activeMappings(page.getId());
            }
            productPageService.fillAdminResponseWithCustomFields(response, page, after);
        } else {
            // Nobody shows the auto sync's page body, and building it (custom
            // fields, settings) every few minutes per store would hold the
            // page lock for nothing: only the counts and lists below are set.
            response.setId(page.getId());
            response.setCode(page.getCode());
        }
        response.setAdded(plan.adds().size());
        response.setDeactivated(plan.deactivations().size());
        for (CatalogueSyncPlanner.Add add : plan.adds()) {
            response.getAddedPackageSessionIds().add(add.pick().packageSessionId());
        }
        for (CatalogueSyncPlanner.Deactivation d : plan.deactivations()) {
            response.getDeactivatedMappings().add(new ProductPageCatalogueSyncResponse.Deactivated(
                    d.row().mappingId(), d.row().packageSessionId(), d.reason(),
                    d.row().packageName(), d.row().levelName()));
        }
        for (CatalogueSyncPlanner.Skip skip : plan.skipped()) {
            response.getSkipped().add(new ProductPageCatalogueSyncResponse.Skipped(
                    skip.pick().packageSessionId(), skip.reason(),
                    skip.pick().packageName(), skip.pick().levelName()));
        }
        response.getWarnings().addAll(plan.warnings());
        if (guardWarning != null) response.getWarnings().add(guardWarning);

        if (!auto) {
            log.info("Catalogue sync of product page {} (institute {}): {} added, {} deactivated, {} skipped, "
                            + "{} catalogue sessions, deactivateMissing={}",
                    page.getId(), instituteId, plan.adds().size(), plan.deactivations().size(),
                    plan.skipped().size(), picks.size(), deactivateMissing);
        } else if (!changed.isEmpty()) {
            log.info("Catalogue auto sync of product page {} (institute {}): {} added, {} deactivated, {} skipped, "
                            + "{} catalogue sessions, deactivateMissing={}",
                    page.getId(), instituteId, plan.adds().size(), plan.deactivations().size(),
                    plan.skipped().size(), picks.size(), deactivateMissing);
        } else {
            // Runs every few minutes per store: an unchanged store is not news.
            log.debug("Catalogue auto sync of product page {} (institute {}): nothing to change, {} skipped, "
                            + "{} catalogue sessions", page.getId(), instituteId, plan.skipped().size(), picks.size());
        }
        return response;
    }

    static CatalogueSyncPlanner.Row toRow(ProductPageInviteMapping mapping, Map<String, PaymentPlan> plans) {
        PackageSessionLearnerInvitationToPaymentOption bridge = mapping.getPsInvitePaymentOption();
        EnrollInvite invite = bridge.getEnrollInvite();
        PackageSession session = bridge.getPackageSession();
        PaymentOption option = bridge.getPaymentOption();
        PaymentPlan plan = plans.get(mapping.getPaymentPlanId());
        return new CatalogueSyncPlanner.Row(
                mapping.getId(),
                mapping.getDisplayOrder(),
                session != null ? session.getId() : null,
                session != null && session.getPackageEntity() != null
                        ? session.getPackageEntity().getPackageName() : null,
                session != null && session.getLevel() != null ? session.getLevel().getLevelName() : null,
                bridge.getId(),
                bridge.getStatus(),
                invite != null ? invite.getId() : null,
                invite != null ? invite.getStatus() : null,
                invite != null ? invite.getStartDate() : null,
                invite != null ? invite.getEndDate() : null,
                invite != null ? invite.getVendor() : null,
                invite != null ? invite.getCurrency() : null,
                option != null,
                option != null ? option.getStatus() : null,
                option != null ? option.getType() : null,
                mapping.getPaymentPlanId(),
                plan != null,
                plan != null ? plan.getStatus() : null,
                plan != null ? Double.valueOf(plan.getActualPrice()) : null,
                plan != null ? plan.getCurrency() : null);
    }

    static CatalogueSyncPlanner.Pick toPick(ProductPageCatalogueSessionRow row) {
        return new CatalogueSyncPlanner.Pick(
                row.getPackageSessionId(),
                row.getPackageName(),
                row.getLevelName(),
                row.getPsliId(),
                row.getInviteId(),
                row.getInviteStatus(),
                row.getInviteTag(),
                row.getInviteStartDate(),
                row.getInviteEndDate(),
                row.getInviteVendor(),
                row.getInviteCurrency(),
                row.getPaymentOptionId(),
                row.getPaymentOptionType(),
                row.getPaymentPlanId(),
                row.getActualPrice(),
                row.getPlanCurrency());
    }
}
