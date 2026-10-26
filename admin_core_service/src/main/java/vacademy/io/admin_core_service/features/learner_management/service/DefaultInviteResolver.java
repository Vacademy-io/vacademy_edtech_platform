package vacademy.io.admin_core_service.features.learner_management.service;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.enums.EnrollInviteTag;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.enroll_invite.service.PackageSessionEnrollInviteToPaymentOptionService;
import vacademy.io.admin_core_service.features.learner_management.dto.AssignmentItemDTO;
import vacademy.io.admin_core_service.features.packages.service.PackageSessionService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentPlanService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.security.SecureRandom;
import java.util.List;
import java.util.Optional;

/**
 * Resolves (or auto-creates) the EnrollInvite, PaymentOption, and PaymentPlan
 * for each assignment item in the bulk assign flow.
 *
 * Resolution order:
 * 1. Explicit IDs from the request (if provided)
 * 2. DEFAULT invite/option/plan for the package session
 * 3. Auto-create a free DEFAULT invite + option + plan if none exists
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DefaultInviteResolver {

    private final EnrollInviteRepository enrollInviteRepository;
    private final PaymentOptionService paymentOptionService;
    private final PaymentOptionRepository paymentOptionRepository;
    private final PaymentPlanService paymentPlanService;
    private final PackageSessionService packageSessionService;
    private final PackageSessionEnrollInviteToPaymentOptionService packageSessionEnrollInviteToPaymentOptionService;

    /**
     * Resolved configuration for a single assignment item.
     */
    @Data
    @AllArgsConstructor
    public static class ResolvedConfig {
        private EnrollInvite enrollInvite;
        private PaymentOption paymentOption;
        private PaymentPlan paymentPlan;
        private PackageSession packageSession;
        private Integer accessDays;
        private boolean autoCreated;
    }

    /**
     * Resolves the full enrollment configuration for a single assignment item.
     *
     * @param item        The assignment item DTO
     * @param instituteId The institute ID
     * @param dryRun      If true, auto-created entities will NOT be persisted
     * @return Fully resolved config with all entities populated
     */
    @Transactional
    public ResolvedConfig resolve(AssignmentItemDTO item, String instituteId, boolean dryRun) {
        if (item == null || !StringUtils.hasText(item.getPackageSessionId())) {
            throw new VacademyException("Assignment item must have a package_session_id");
        }

        PackageSession packageSession = packageSessionService.findById(item.getPackageSessionId());
        boolean autoCreated = false;

        // --- Step 1: Resolve EnrollInvite ---
        EnrollInvite enrollInvite;
        if (StringUtils.hasText(item.getEnrollInviteId())) {
            // Explicit invite provided
            enrollInvite = enrollInviteRepository.findById(item.getEnrollInviteId())
                    .orElseThrow(() -> new VacademyException(
                            "EnrollInvite not found: " + item.getEnrollInviteId()));
        } else {
            // Auto-resolve: find DEFAULT invite for this package session
            Optional<EnrollInvite> defaultInvite = enrollInviteRepository
                    .findLatestForPackageSessionWithFilters(
                            item.getPackageSessionId(),
                            List.of(StatusEnum.ACTIVE.name()),
                            List.of(EnrollInviteTag.DEFAULT.name()),
                            List.of(StatusEnum.ACTIVE.name()));

            if (defaultInvite.isPresent()) {
                enrollInvite = defaultInvite.get();
                log.info("Resolved DEFAULT invite '{}' for packageSession={}",
                        enrollInvite.getId(), item.getPackageSessionId());
            } else {
                // Auto-create a free default invite
                log.info("No DEFAULT invite found for packageSession={}. Auto-creating...",
                        item.getPackageSessionId());

                if (dryRun) {
                    // In dry-run, create transient objects (not persisted)
                    enrollInvite = buildAutoInvite(instituteId);
                    PaymentOption autoOption = buildAutoPaymentOption();
                    PaymentPlan autoPlan = buildAutoPaymentPlan(autoOption);
                    Integer accessDays = resolveAccessDays(item, autoPlan, enrollInvite);
                    return new ResolvedConfig(enrollInvite, autoOption, autoPlan,
                            packageSession, accessDays, true);
                }

                enrollInvite = createAndPersistAutoInvite(packageSession, instituteId);
                autoCreated = true;
            }
        }

        // --- Step 2: Resolve PaymentOption ---
        PaymentOption paymentOption;
        if (StringUtils.hasText(item.getPaymentOptionId())) {
            paymentOption = paymentOptionService.findById(item.getPaymentOptionId());
        } else {
            paymentOption = resolvePaymentOption(enrollInvite, packageSession);
        }

        // --- Step 3: Resolve PaymentPlan ---
        PaymentPlan paymentPlan;
        if (StringUtils.hasText(item.getPlanId())) {
            paymentPlan = paymentPlanService.findById(item.getPlanId())
                    .orElseThrow(() -> new VacademyException("PaymentPlan not found: " + item.getPlanId()));
        } else {
            paymentPlan = resolvePaymentPlan(paymentOption);
        }

        // --- Step 4: Resolve AccessDays ---
        Integer accessDays = resolveAccessDays(item, paymentPlan, enrollInvite);

        return new ResolvedConfig(enrollInvite, paymentOption, paymentPlan,
                packageSession, accessDays, autoCreated);
    }

    // ============================= PRIVATE HELPERS =============================

    private PaymentOption resolvePaymentOption(EnrollInvite enrollInvite,
            PackageSession packageSession) {
        // Try to find the payment option linked to this invite for this package session
        List<PackageSessionLearnerInvitationToPaymentOption> mappings = packageSessionEnrollInviteToPaymentOptionService
                .findByInvite(enrollInvite);

        // Filter for this specific package session + ACTIVE status
        Optional<PackageSessionLearnerInvitationToPaymentOption> match = mappings.stream()
                .filter(m -> m.getPackageSession() != null
                        && m.getPackageSession().getId().equals(packageSession.getId())
                        && StatusEnum.ACTIVE.name().equals(m.getStatus()))
                .findFirst();

        if (match.isPresent() && match.get().getPaymentOption() != null) {
            return match.get().getPaymentOption();
        }

        // Fallback: take any ACTIVE payment option from the invite
        Optional<PaymentOption> anyOption = mappings.stream()
                .filter(m -> StatusEnum.ACTIVE.name().equals(m.getStatus()))
                .map(PackageSessionLearnerInvitationToPaymentOption::getPaymentOption)
                .filter(po -> po != null && StatusEnum.ACTIVE.name().equals(po.getStatus()))
                .findFirst();

        if (anyOption.isPresent()) {
            return anyOption.get();
        }

        throw new VacademyException(
                "No active PaymentOption found for invite=" + enrollInvite.getId()
                        + " and packageSession=" + packageSession.getId());
    }

    private PaymentPlan resolvePaymentPlan(PaymentOption paymentOption) {
        List<PaymentPlan> plans = paymentPlanService.findByPaymentOption(paymentOption);
        List<PaymentPlan> activePlans = plans.stream()
                .filter(p -> StatusEnum.ACTIVE.name().equals(p.getStatus()))
                .toList();

        if (activePlans.isEmpty()) {
            throw new VacademyException(
                    "No active PaymentPlan found for PaymentOption=" + paymentOption.getId()
                            + " (\"" + paymentOption.getName() + "\"). Add a price to it in Settings > Payment,"
                            + " or pick another payment option on this course's invite link.");
        }

        // Prefer a plan tagged DEFAULT if multiple exist
        return activePlans.stream()
                .filter(p -> "DEFAULT".equals(p.getTag()))
                .findFirst()
                .orElse(activePlans.get(0));
    }

    private Integer resolveAccessDays(AssignmentItemDTO item, PaymentPlan plan,
            EnrollInvite invite) {
        // Priority: explicit > plan > invite
        if (item.getAccessDays() != null) {
            return item.getAccessDays();
        }
        if (plan != null && plan.getValidityInDays() != null) {
            return plan.getValidityInDays();
        }
        if (invite != null && invite.getLearnerAccessDays() != null) {
            return invite.getLearnerAccessDays();
        }
        return null; // unlimited
    }

    // ============================= AUTO-CREATE LOGIC =============================

    @Transactional
    protected EnrollInvite createAndPersistAutoInvite(PackageSession packageSession,
            String instituteId) {
        // 1. Create EnrollInvite
        EnrollInvite invite = buildAutoInvite(instituteId);
        invite = enrollInviteRepository.save(invite);
        log.info("Auto-created EnrollInvite id={} for institute={}", invite.getId(), instituteId);

        // 2. Create PaymentOption
        PaymentOption option = buildAutoPaymentOption();
        option = paymentOptionRepository.save(option);
        log.info("Auto-created PaymentOption id={}", option.getId());

        // 3. Create PaymentPlan linked to the option
        PaymentPlan plan = buildAutoPaymentPlan(option);
        // PaymentPlan is cascaded from PaymentOption, but let's be explicit
        option.getPaymentPlans().add(plan);
        paymentOptionRepository.save(option);
        log.info("Auto-created PaymentPlan for PaymentOption id={}", option.getId());

        // 4. Link invite ↔ packageSession ↔ paymentOption
        PackageSessionLearnerInvitationToPaymentOption mapping = new PackageSessionLearnerInvitationToPaymentOption(
                invite, packageSession, option, StatusEnum.ACTIVE.name());
        packageSessionEnrollInviteToPaymentOptionService
                .createPackageSessionLearnerInvitationToPaymentOptions(List.of(mapping));
        log.info("Linked auto-created invite {} → packageSession {} → paymentOption {}",
                invite.getId(), packageSession.getId(), option.getId());

        return invite;
    }

    private EnrollInvite buildAutoInvite(String instituteId) {
        EnrollInvite invite = new EnrollInvite();
        invite.setName("Auto Default (Bulk Assign)");
        invite.setTag(EnrollInviteTag.DEFAULT.name());
        invite.setStatus(StatusEnum.ACTIVE.name());
        invite.setInstituteId(instituteId);
        invite.setInviteCode(generateInviteCode());
        invite.setIsBundled(false);
        return invite;
    }

    private PaymentOption buildAutoPaymentOption() {
        PaymentOption option = new PaymentOption();
        option.setName("Free Access (Auto)");
        option.setType("FREE");
        option.setTag("DEFAULT");
        option.setStatus(StatusEnum.ACTIVE.name());
        option.setRequireApproval(false);
        return option;
    }

    private PaymentPlan buildAutoPaymentPlan(PaymentOption option) {
        PaymentPlan plan = new PaymentPlan();
        plan.setName("Free Plan (Auto)");
        plan.setStatus(StatusEnum.ACTIVE.name());
        plan.setActualPrice(0);
        plan.setElevatedPrice(0);
        plan.setTag("DEFAULT");
        plan.setPaymentOption(option);
        return plan;
    }

    private String generateInviteCode() {
        String chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom random = new SecureRandom();
        StringBuilder sb = new StringBuilder(6);
        for (int i = 0; i < 6; i++) {
            sb.append(chars.charAt(random.nextInt(chars.length())));
        }
        return sb.toString();
    }
}
