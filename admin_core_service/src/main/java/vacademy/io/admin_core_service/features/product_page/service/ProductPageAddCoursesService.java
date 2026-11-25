package vacademy.io.admin_core_service.features.product_page.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageAddCoursesRequest;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageCatalogueSyncResponse;
import vacademy.io.admin_core_service.features.product_page.dto.ProductPageInviteMappingRequest;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPage;
import vacademy.io.admin_core_service.features.product_page.entity.ProductPageInviteMapping;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageInviteMappingRepository;
import vacademy.io.admin_core_service.features.product_page.repository.ProductPageRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Adds courses to a product page and leaves the courses it already sells as
 * they are. PUT /update replaces every mapping of the page, so a caller that
 * only wants to add one course (an eBook into its folder's page) would have to
 * send the whole page back; this adds rows in place, the way the catalogue sync
 * appends, under the same page lock.
 *
 * Every row is checked before anything is written (all or nothing): the
 * enrollment-link row must be ACTIVE and belong to the institute, and the plan
 * must be an ACTIVE plan of that row's payment option. A batch the page already
 * sells (through any row) is skipped as already_on_page, never duplicated. A
 * course on another payment gateway or in another currency than the page is
 * skipped (vendor_mismatch / currency_mismatch) by the catalogue sync's own rule
 * (CatalogueSyncPlanner.pageTerms / termsReason): one checkout charges one
 * gateway in one currency, and a new course on top would otherwise decide both.
 */
@Slf4j
@Service
public class ProductPageAddCoursesService {

    static final String STATUS_ACTIVE = "ACTIVE";
    static final String STATUS_DELETED = "DELETED";
    static final String POSITION_FIRST = "FIRST";
    static final String POSITION_LAST = "LAST";
    static final String REASON_ALREADY_ON_PAGE = "already_on_page";
    /** Most rows one call may add. */
    static final int MAX_MAPPINGS = 100;

    @Autowired
    private ProductPageRepository productPageRepository;

    @Autowired
    private ProductPageInviteMappingRepository mappingRepository;

    @Autowired
    private PackageSessionLearnerInvitationToPaymentOptionRepository bridgeRepository;

    @Autowired
    private PaymentPlanRepository paymentPlanRepository;

    @Autowired
    private ProductPageService productPageService;

    @Autowired
    private InstituteAccessValidator accessValidator;

    @PersistenceContext
    private EntityManager entityManager;

    private record Pending(PackageSessionLearnerInvitationToPaymentOption bridge, PaymentPlan plan,
                           boolean preselected) {
    }

    @Transactional
    public ProductPageCatalogueSyncResponse addCourses(CustomUserDetails user, String productPageId,
                                                       String instituteId, ProductPageAddCoursesRequest request) {
        return addCourses(user, productPageId, instituteId, request, false);
    }

    /**
     * dryRun: the same checks and the same added / skipped answer, with nothing
     * written (no row added, none moved), so a caller can show exactly what an
     * apply would do.
     */
    @Transactional
    public ProductPageCatalogueSyncResponse addCourses(CustomUserDetails user, String productPageId,
                                                       String instituteId, ProductPageAddCoursesRequest request,
                                                       boolean dryRun) {
        accessValidator.requireInstituteAdmin(user, instituteId);
        if (!StringUtils.hasText(productPageId)) {
            throw new VacademyException("productPageId is required");
        }
        List<ProductPageInviteMappingRequest> wanted = request != null ? request.getMappings() : null;
        if (wanted == null || wanted.isEmpty()) {
            throw new VacademyException("mappings is required: [{ps_invite_payment_option_id, payment_plan_id}]");
        }
        if (wanted.size() > MAX_MAPPINGS) {
            throw new VacademyException("At most " + MAX_MAPPINGS + " mappings per call");
        }
        String position = StringUtils.hasText(request.getPosition())
                ? request.getPosition().trim().toUpperCase() : POSITION_FIRST;
        if (!POSITION_FIRST.equals(position) && !POSITION_LAST.equals(position)) {
            throw new VacademyException("position is FIRST or LAST");
        }

        // Locked like the editor's save and the catalogue sync, so none of them interleave.
        ProductPage page = productPageRepository.lockByIdAndInstituteId(productPageId.trim(), instituteId)
                .filter(p -> !STATUS_DELETED.equals(p.getStatus()))
                .orElseThrow(() -> new VacademyException("Product page not found"));

        List<ProductPageInviteMapping> active = productPageService.activeMappings(page.getId());
        Set<String> soldSessions = new HashSet<>();
        for (ProductPageInviteMapping m : active) {
            String sessionId = sessionIdOf(m.getPsInvitePaymentOption());
            if (sessionId != null) soldSessions.add(sessionId);
        }

        ProductPageCatalogueSyncResponse response = new ProductPageCatalogueSyncResponse();
        List<Pending> adds = new ArrayList<>();
        for (ProductPageInviteMappingRequest req : wanted) {
            if (req == null) {
                throw new VacademyException("Each mapping needs ps_invite_payment_option_id and payment_plan_id");
            }
            PackageSessionLearnerInvitationToPaymentOption bridge = requireBridge(req.getPsInvitePaymentOptionId(),
                    instituteId);
            PaymentPlan plan = requirePlan(req.getPaymentPlanId(), bridge);
            String sessionId = sessionIdOf(bridge);
            if (sessionId == null) {
                throw new VacademyException("The enrollment link row " + bridge.getId() + " has no batch");
            }
            if (!soldSessions.add(sessionId)) {
                PackageSession ps = bridge.getPackageSession();
                response.getSkipped().add(new ProductPageCatalogueSyncResponse.Skipped(sessionId,
                        REASON_ALREADY_ON_PAGE,
                        ps.getPackageEntity() != null ? ps.getPackageEntity().getPackageName() : null,
                        ps.getLevel() != null ? ps.getLevel().getLevelName() : null));
                continue;
            }
            adds.add(new Pending(bridge, plan, req.isPreselected()));
        }
        adds = withinPageTerms(active, adds, response);
        if (dryRun) {
            for (Pending add : adds) response.getAddedPackageSessionIds().add(sessionIdOf(add.bridge()));
            productPageService.fillAdminResponseWithCustomFields(response, page, active);
            response.setAdded(adds.size());
            return response;
        }

        List<ProductPageInviteMapping> changed = new ArrayList<>();
        int start;
        if (POSITION_FIRST.equals(position)) {
            // The page's courses keep their order and move down past the new ones.
            int order = adds.size();
            for (ProductPageInviteMapping m : active) {
                if (!adds.isEmpty() && m.getDisplayOrder() != order) {
                    m.setDisplayOrder(order);
                    changed.add(m);
                }
                order++;
            }
            start = 0;
        } else {
            int max = -1;
            for (ProductPageInviteMapping m : active) max = Math.max(max, m.getDisplayOrder());
            start = max + 1;
        }
        for (int i = 0; i < adds.size(); i++) {
            Pending add = adds.get(i);
            ProductPageInviteMapping mapping = new ProductPageInviteMapping();
            mapping.setProductPage(page);
            mapping.setPsInvitePaymentOption(add.bridge());
            mapping.setPaymentPlanId(add.plan().getId());
            mapping.setPreselected(add.preselected());
            mapping.setDisplayOrder(start + i);
            mapping.setStatus(STATUS_ACTIVE);
            changed.add(mapping);
            response.getAddedPackageSessionIds().add(sessionIdOf(add.bridge()));
        }

        List<ProductPageInviteMapping> after = active;
        if (!changed.isEmpty()) {
            mappingRepository.saveAll(changed);
            mappingRepository.flush();
            entityManager.clear();
            after = productPageService.activeMappings(page.getId());
        }
        productPageService.fillAdminResponseWithCustomFields(response, page, after);
        response.setAdded(adds.size());
        log.info("Added {} course rows to product page {} (institute {}), {} skipped, position {}",
                adds.size(), page.getId(), instituteId, response.getSkipped().size(), position);
        return response;
    }

    private PackageSessionLearnerInvitationToPaymentOption requireBridge(String id, String instituteId) {
        if (!StringUtils.hasText(id)) {
            throw new VacademyException("Each mapping needs ps_invite_payment_option_id and payment_plan_id");
        }
        return bridgeRepository.findById(id.trim())
                .filter(b -> STATUS_ACTIVE.equals(b.getStatus()))
                .filter(b -> b.getEnrollInvite() != null && instituteId.equals(b.getEnrollInvite().getInstituteId()))
                .filter(b -> b.getPackageSession() != null && !STATUS_DELETED.equals(b.getPackageSession().getStatus()))
                .orElseThrow(() -> new VacademyException(
                        "Enrollment link row not found, not active or not this institute's: " + id.trim()));
    }

    /**
     * The adds the page can take: a course on another gateway or in another
     * currency than the page (the catalogue sync's rule) goes to skipped instead.
     */
    private List<Pending> withinPageTerms(List<ProductPageInviteMapping> active, List<Pending> adds,
                                          ProductPageCatalogueSyncResponse response) {
        if (adds.isEmpty()) return adds;
        Map<String, PaymentPlan> plans = productPageService.loadPlans(active);
        List<CatalogueSyncPlanner.Row> rows = new ArrayList<>();
        for (ProductPageInviteMapping m : active) rows.add(ProductPageCatalogueSyncService.toRow(m, plans));
        List<CatalogueSyncPlanner.Pick> picks = new ArrayList<>();
        for (Pending add : adds) picks.add(toPick(add));
        CatalogueSyncPlanner.Terms terms = CatalogueSyncPlanner.pageTerms(rows, picks);
        List<Pending> kept = new ArrayList<>();
        for (int i = 0; i < adds.size(); i++) {
            String reason = CatalogueSyncPlanner.termsReason(picks.get(i), terms);
            if (reason == null) {
                kept.add(adds.get(i));
            } else {
                CatalogueSyncPlanner.Pick pick = picks.get(i);
                response.getSkipped().add(new ProductPageCatalogueSyncResponse.Skipped(
                        pick.packageSessionId(), reason, pick.packageName(), pick.levelName()));
            }
        }
        return kept;
    }

    private static CatalogueSyncPlanner.Pick toPick(Pending add) {
        PackageSessionLearnerInvitationToPaymentOption bridge = add.bridge();
        EnrollInvite invite = bridge.getEnrollInvite();
        PackageSession session = bridge.getPackageSession();
        PaymentOption option = bridge.getPaymentOption();
        PaymentPlan plan = add.plan();
        return new CatalogueSyncPlanner.Pick(
                session.getId(),
                session.getPackageEntity() != null ? session.getPackageEntity().getPackageName() : null,
                session.getLevel() != null ? session.getLevel().getLevelName() : null,
                bridge.getId(),
                invite.getId(),
                invite.getStatus(),
                invite.getTag(),
                invite.getStartDate(),
                invite.getEndDate(),
                invite.getVendor(),
                invite.getCurrency(),
                option != null ? option.getId() : null,
                option != null ? option.getType() : null,
                plan.getId(),
                plan.getActualPrice(),
                plan.getCurrency());
    }

    private PaymentPlan requirePlan(String planId, PackageSessionLearnerInvitationToPaymentOption bridge) {
        if (!StringUtils.hasText(planId)) {
            throw new VacademyException("Each mapping needs ps_invite_payment_option_id and payment_plan_id");
        }
        String optionId = bridge.getPaymentOption() != null ? bridge.getPaymentOption().getId() : null;
        PaymentPlan plan = paymentPlanRepository.findById(planId.trim())
                .filter(p -> STATUS_ACTIVE.equals(p.getStatus()))
                .filter(p -> optionId != null && p.getPaymentOption() != null
                        && optionId.equals(p.getPaymentOption().getId()))
                .orElseThrow(() -> new VacademyException("Payment plan " + planId.trim()
                        + " is not an active plan of the payment option on row " + bridge.getId()));
        return plan;
    }

    private static String sessionIdOf(PackageSessionLearnerInvitationToPaymentOption bridge) {
        return bridge != null && bridge.getPackageSession() != null ? bridge.getPackageSession().getId() : null;
    }
}
