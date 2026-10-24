package vacademy.io.admin_core_service.features.plan_change.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.enroll_invite.entity.PackageSessionLearnerInvitationToPaymentOption;
import vacademy.io.admin_core_service.features.enroll_invite.repository.PackageSessionLearnerInvitationToPaymentOptionRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.plan_change.enums.PlanChangeDirection;
import vacademy.io.admin_core_service.features.plan_change.enums.PlanChangeEffectiveType;
import vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.service.UserInstitutePaymentGatewayMappingService;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Finds every plan a given learner is allowed to switch to, and prices each one.
 *
 * <h2>Why the candidate set looks the way it does</h2>
 *
 * A PaymentOption is reachable only through an EnrollInvite — the bridge
 * {@code package_session_learner_invitation_to_payment_option} binds
 * (invite, package session, option), and the runtime lookup
 * {@code findActiveByEnrollInviteIdAndPackageSessionId} returns an Optional, i.e. one
 * option per (invite, package session). So the set of options a learner could plausibly be
 * on is "every option bound by an ACTIVE invite to one of the package sessions they are
 * already enrolled in", which is exactly what
 * {@code findActiveByPackageSessionIdsAndInstituteId} returns.
 *
 * <p>Staying on the learner's own package sessions is what keeps this tractable:
 * {@code StudentSessionInstituteGroupMapping} carries no invite or option reference, so a
 * change never has to rewrite enrollment rows — only extend their expiry. Moving a learner
 * to a different course/batch is enrollment, not a plan change, and is already served by
 * cancel + re-enroll.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PlanChangeTargetResolver {

    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final PackageSessionLearnerInvitationToPaymentOptionRepository bridgeRepository;
    private final PlanChangeProrationCalculator prorationCalculator;
    private final UserInstitutePaymentGatewayMappingService mandateService;

    /**
     * Option types that can take part in a plan change.
     *
     * <p>CPO is out because it carries an installment tree — switching into one would have
     * to regenerate {@code student_fee_payment} bills and re-allocate what was already
     * paid. DONATION is out because it has no fixed price to prorate against. FREE options
     * are out as a target type; a free destination is expressed as a zero-priced plan
     * inside a SUBSCRIPTION/ONE_TIME option, which downgrades cleanly at end of cycle.
     */
    private static final Set<String> SWITCHABLE_OPTION_TYPES = Set.of(
            PaymentOptionType.SUBSCRIPTION.name(),
            PaymentOptionType.ONE_TIME.name());

    /** One candidate, before it is turned into a DTO. */
    public record Candidate(
            PaymentPlan plan,
            PaymentOption option,
            String enrollInviteId,
            PlanChangeDirection direction,
            PlanChangeEffectiveType effectiveType,
            PlanChangeProrationCalculator.Proration proration,
            boolean requiresMandateReauth,
            boolean crossOption) {
    }

    /** The package sessions this UserPlan currently grants. Empty means nothing to switch. */
    public List<String> activePackageSessionIds(String userPlanId) {
        List<String> active = packageSessionIds(userPlanId, LearnerSessionStatusEnum.ACTIVE.name());
        if (!active.isEmpty()) {
            return active;
        }
        // An expired or terminated membership has no ACTIVE mapping -- expiry deactivates
        // them -- so keying only on ACTIVE left exactly the learners in a recovery state
        // with no targets, and no "Change plan" on their dashboard, however permissive
        // CHANGEABLE_STATUSES was. Their INACTIVE rows still name the course they were
        // enrolled in, which is all this needs; applying a change revives them.
        return packageSessionIds(userPlanId, LearnerSessionStatusEnum.INACTIVE.name());
    }

    private List<String> packageSessionIds(String userPlanId, String status) {
        return mappingRepository
                .findByUserPlanIdAndStatus(userPlanId, status)
                .stream()
                .map(StudentSessionInstituteGroupMapping::getPackageSession)
                .filter(java.util.Objects::nonNull)
                .map(ps -> ps.getId())
                .distinct()
                .toList();
    }

    /**
     * Every plan the learner may move to, priced for this moment. Ordered by the option's
     * own plan ordering (shortest cycle first), grouped by option in encounter order.
     */
    public List<Candidate> resolve(UserPlan userPlan, String instituteId) {
        return resolve(userPlan, instituteId, activePackageSessionIds(userPlan.getId()));
    }

    /**
     * As above, for callers that already hold the learner's ACTIVE package sessions — the
     * subscription listing computes them for its own DTO, and re-querying them per
     * membership on the learner's dashboard is pure waste.
     */
    public List<Candidate> resolve(UserPlan userPlan, String instituteId, List<String> packageSessionIds) {
        // A regionally priced membership has no switch targets yet: proration, the target's
        // price and the new lock would all have to be worked out in the locked currency, and
        // pricing them from base plan prices would charge a USD member in rupees.
        if (RegionalPriceLock.isLocked(userPlan)) {
            log.debug("Plan change: user plan {} is regionally priced ({}) — no targets",
                    userPlan.getId(), userPlan.getRegionalCurrency());
            return List.of();
        }
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            log.debug("Plan change: user plan {} grants no ACTIVE package session — no targets",
                    userPlan.getId());
            return List.of();
        }

        List<PackageSessionLearnerInvitationToPaymentOption> bridges =
                bridgeRepository.findActiveByPackageSessionIdsAndInstituteId(packageSessionIds, instituteId);

        String currentCurrency = currentCurrency(userPlan);
        MandateInfo mandate = resolveMandate(userPlan, instituteId);
        Date now = new Date();

        // The same option can be bound to several of the learner's package sessions; keep
        // the first binding we see so a plan is offered exactly once.
        Map<String, Candidate> byPlanId = new LinkedHashMap<>();
        Set<String> rejectedOptions = new HashSet<>();

        for (PackageSessionLearnerInvitationToPaymentOption bridge : bridges) {
            PaymentOption option = bridge.getPaymentOption();
            if (option == null || !isSwitchableOption(option)) {
                if (option != null) {
                    rejectedOptions.add(option.getId());
                }
                continue;
            }
            String enrollInviteId = bridge.getEnrollInvite() != null ? bridge.getEnrollInvite().getId() : null;
            boolean crossOption = !option.getId().equals(userPlan.getPaymentOptionId());

            for (PaymentPlan plan : safePlans(option)) {
                if (byPlanId.containsKey(plan.getId())) {
                    continue;
                }
                if (!isSwitchablePlan(plan, userPlan, currentCurrency)) {
                    continue;
                }
                // Upgrades only. A downgrade or a lateral move would have to wait for the
                // end of the paid cycle and re-register the mandate at a LOWER ceiling,
                // which is not a product we offer: the learner keeps the plan they bought
                // until it ends and may take a cheaper one by re-enrolling afterwards.
                if (direction(currentPriceOf(userPlan), plan.getActualPrice()) != PlanChangeDirection.UPGRADE) {
                    continue;
                }
                byPlanId.put(plan.getId(),
                        toCandidate(userPlan, plan, option, enrollInviteId, crossOption, mandate, now));
            }
        }

        if (!rejectedOptions.isEmpty()) {
            log.debug("Plan change: {} option(s) skipped for user plan {} (not switchable)",
                    rejectedOptions.size(), userPlan.getId());
        }
        return new ArrayList<>(byPlanId.values());
    }

    /** Resolve a single target by id, applying the exact same rules the listing does. */
    public Candidate resolveOne(UserPlan userPlan, String instituteId, String targetPlanId) {
        return resolve(userPlan, instituteId).stream()
                .filter(c -> c.plan().getId().equals(targetPlanId))
                .findFirst()
                .orElse(null);
    }

    private static double currentPriceOf(UserPlan userPlan) {
        return userPlan.getPaymentPlan() != null ? userPlan.getPaymentPlan().getActualPrice() : 0d;
    }

    private Candidate toCandidate(UserPlan userPlan, PaymentPlan plan, PaymentOption option,
            String enrollInviteId, boolean crossOption, MandateInfo mandate, Date now) {
        double currentPrice = currentPriceOf(userPlan);
        PlanChangeDirection direction = direction(currentPrice, plan.getActualPrice());

        // Only an upgrade takes money now. Anything else waits for the end of the paid
        // cycle so the learner keeps what they bought and we never owe a refund.
        PlanChangeEffectiveType effectiveType = direction == PlanChangeDirection.UPGRADE
                ? PlanChangeEffectiveType.IMMEDIATE
                : PlanChangeEffectiveType.END_OF_CYCLE;

        PlanChangeProrationCalculator.Proration proration = prorationCalculator.compute(userPlan, plan, now);

        return new Candidate(plan, option, enrollInviteId, direction, effectiveType, proration,
                requiresMandateReauth(userPlan, plan, mandate, crossOption, enrollInviteId), crossOption);
    }

    private PlanChangeDirection direction(double currentPrice, double targetPrice) {
        if (targetPrice > currentPrice) {
            return PlanChangeDirection.UPGRADE;
        }
        if (targetPrice < currentPrice) {
            return PlanChangeDirection.DOWNGRADE;
        }
        return PlanChangeDirection.LATERAL;
    }

    /**
     * Whether taking this target breaks the learner's existing auto-pay mandate.
     *
     * <p>Two ways it can: the mandate carries a {@code max_amount} ceiling and the gateway
     * refuses any recurring charge above it (so the upgrade would succeed and then every
     * future renewal would silently fail), or a cross-option move lands on an invite using
     * a different gateway, leaving the mandate registered with the wrong provider. Either
     * way the learner has to re-authorise, and the UI needs to know before it offers a
     * plain checkout.
     */
    private boolean requiresMandateReauth(UserPlan userPlan, PaymentPlan target, MandateInfo mandate,
            boolean crossOption, String targetEnrollInviteId) {
        if (mandate == null || !MandateInfo.STATUS_ACTIVE.equalsIgnoreCase(mandate.getStatus())) {
            // No usable mandate. Harmless while the plan renews manually, but if the change
            // leaves auto-pay ARMED -- which it does whenever the target invite has autopay
            // on, or the learner already had it on -- the plan would carry a charge date
            // with nothing behind it: the sweep finds no ACTIVE mandate, skips, and the
            // membership silently never renews. Force the re-registration instead, so the
            // one approval that pays for the upgrade also arms a mandate at the new price.
            return willArmAutopay(userPlan, crossOption, targetEnrollInviteId);
        }
        if (mandate.getMaxAmount() != null && target.getActualPrice() > mandate.getMaxAmount()) {
            return true;
        }
        if (crossOption && targetEnrollInviteId != null
                && !targetEnrollInviteId.equals(userPlan.getEnrollInviteId())) {
            // Vendor lives on the invite; a different invite may well mean a different gateway.
            String currentVendor = userPlan.getEnrollInvite() != null
                    ? userPlan.getEnrollInvite().getVendor()
                    : null;
            String targetVendor = targetVendor(targetEnrollInviteId);
            return StringUtils.hasText(targetVendor) && !targetVendor.equalsIgnoreCase(currentVendor);
        }
        return false;
    }

    /**
     * Whether the plan will have auto-renewal on once the change is applied. Mirrors
     * {@code PlanChangeService.reapplyAutopay}: a cross-option move re-derives it from the
     * target invite, a same-option move keeps what the plan already has.
     */
    private boolean willArmAutopay(UserPlan userPlan, boolean crossOption, String targetEnrollInviteId) {
        if (!crossOption || targetEnrollInviteId == null) {
            return Boolean.TRUE.equals(userPlan.getAutoRenewalEnabled());
        }
        return bridgeRepository
                .findByEnrollInviteIdAndStatusWithPackageSession(targetEnrollInviteId, List.of(StatusEnum.ACTIVE.name()))
                .stream()
                .findFirst()
                .map(b -> b.getEnrollInvite())
                .filter(java.util.Objects::nonNull)
                .map(invite -> autopayEnabledOn(invite.getSettingJson()))
                .orElse(false);
    }

    /** AUTOPAY_SETTING.ENABLED on an invite's settingJson. False on anything unreadable. */
    private boolean autopayEnabledOn(String settingJson) {
        if (!StringUtils.hasText(settingJson)) {
            return false;
        }
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(settingJson)
                    .path("setting").path("AUTOPAY_SETTING").path("ENABLED").asBoolean(false);
        } catch (Exception e) {
            log.warn("Plan change: could not read AUTOPAY_SETTING on target invite: {}", e.getMessage());
            return false;
        }
    }

    /**
     * Vendor of the invite a target is reached through. Read off the bridge rows we already
     * fetched rather than a second query -- callers pass an invite id that came from one.
     */
    private String targetVendor(String enrollInviteId) {
        return bridgeRepository
                .findByEnrollInviteIdAndStatusWithPackageSession(enrollInviteId, List.of(StatusEnum.ACTIVE.name()))
                .stream()
                .findFirst()
                .map(b -> b.getEnrollInvite() != null ? b.getEnrollInvite().getVendor() : null)
                .orElse(null);
    }

    private boolean isSwitchableOption(PaymentOption option) {
        return StatusEnum.ACTIVE.name().equalsIgnoreCase(option.getStatus())
                && Boolean.TRUE.equals(option.getPlanChangeAllowed())
                && option.getType() != null
                && SWITCHABLE_OPTION_TYPES.contains(option.getType().toUpperCase());
    }

    private boolean isSwitchablePlan(PaymentPlan plan, UserPlan userPlan, String currentCurrency) {
        if (plan == null || plan.getId() == null) {
            return false;
        }
        if (plan.getId().equals(userPlan.getPaymentPlanId())) {
            return false; // already on it
        }
        if (!StatusEnum.ACTIVE.name().equalsIgnoreCase(plan.getStatus())) {
            return false;
        }
        if (!Boolean.TRUE.equals(plan.getPlanChangeAllowed())) {
            return false;
        }
        // No cross-currency conversion: a credit computed in one currency cannot be
        // subtracted from a price in another.
        return currentCurrency == null
                || plan.getCurrency() == null
                || currentCurrency.equalsIgnoreCase(plan.getCurrency());
    }

    /**
     * {@code PaymentOption.paymentPlans} is lazily loaded and already filtered to ACTIVE
     * and ordered shortest-cycle-first by the entity mapping.
     */
    private List<PaymentPlan> safePlans(PaymentOption option) {
        return option.getPaymentPlans() != null ? option.getPaymentPlans() : List.of();
    }

    private String currentCurrency(UserPlan userPlan) {
        if (userPlan.getPaymentPlan() != null && StringUtils.hasText(userPlan.getPaymentPlan().getCurrency())) {
            return userPlan.getPaymentPlan().getCurrency();
        }
        return userPlan.getEnrollInvite() != null ? userPlan.getEnrollInvite().getCurrency() : null;
    }

    /** Best-effort — a mandate lookup failure must not hide the whole options list. */
    private MandateInfo resolveMandate(UserPlan userPlan, String instituteId) {
        String vendor = userPlan.getEnrollInvite() != null ? userPlan.getEnrollInvite().getVendor() : null;
        if (!StringUtils.hasText(vendor)) {
            return null;
        }
        try {
            return mandateService.getMandate(userPlan.getUserId(), instituteId, vendor, userPlan.getId());
        } catch (Exception e) {
            log.warn("Plan change: could not read mandate for user plan {}: {}", userPlan.getId(), e.getMessage());
            return null;
        }
    }
}
