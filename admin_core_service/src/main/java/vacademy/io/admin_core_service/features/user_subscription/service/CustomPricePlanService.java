package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * A payment plan at a price an admin agreed with one learner (an admin invoice for a renewal or
 * an enrolment, with "charge this on future renewals").
 *
 * <p>The learner's membership is moved onto (or enrolled on) a real plan at that price, so every
 * renewal charges it the normal way: autopay sweep, pay-to-continue, renewal invoices, ledger
 * accruals all read {@code user_plan.plan_id}. Nothing about the learner's own price lock
 * (user_plan.regional_price) is used, so discounts are not rescaled and plan change keeps working.
 *
 * <p>Order of preference: the plan itself when the price is unchanged; a catalogue plan of the
 * same payment option at that price, validity and currency; a custom plan made for an earlier
 * invoice at that price; otherwise a new one.
 *
 * <p>A custom plan is created under the same payment option with status {@value #STATUS_PRIVATE}
 * and tag {@value #TAG}. {@code PaymentOption.paymentPlans} only loads ACTIVE plans, so it never
 * appears on invite pages, enrolment pickers or plan-change targets, and no other learner can
 * pick it; the memberships that point at it still load it directly.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CustomPricePlanService {

    public static final String STATUS_PRIVATE = "PRIVATE";
    public static final String TAG = "INVOICE_CUSTOM";

    private static final List<String> PRICEABLE_TYPES =
            List.of(PaymentOptionType.SUBSCRIPTION.name(), PaymentOptionType.ONE_TIME.name());

    private final PaymentPlanRepository paymentPlanRepository;
    private final UserInstitutePaymentGatewayMappingService mandateService;

    /**
     * Why {@code price} cannot become the renewal price of this plan, or null when it can.
     *
     * @param membership the membership being renewed (null for a new enrolment)
     */
    public String refusal(UserPlan membership, PaymentPlan basePlan, PaymentOption option,
                          BigDecimal price, String currency, String instituteId) {
        if (price == null || price.signum() <= 0) {
            return "A renewal price must be more than zero";
        }
        if (basePlan == null || option == null) {
            return "This has no payment plan to set a renewal price on";
        }
        String type = option.getType() == null ? "" : option.getType().trim().toUpperCase();
        if (!PRICEABLE_TYPES.contains(type)) {
            return "A renewal price can only be set on a subscription or one-time plan (this one is "
                    + (type.isEmpty() ? "unknown" : type) + ")";
        }
        if (StringUtils.hasText(basePlan.getCurrency()) && StringUtils.hasText(currency)
                && !basePlan.getCurrency().equalsIgnoreCase(currency)) {
            return "The invoice is in " + currency + " but the plan is priced in " + basePlan.getCurrency()
                    + ". Raise the invoice in " + basePlan.getCurrency() + " to set it as the renewal price.";
        }
        if (membership != null && RegionalPriceLock.isLocked(membership)) {
            return "This membership has a regional price (" + membership.getRegionalCurrency() + " "
                    + membership.getRegionalPrice() + "). Change it from the membership's Change price instead.";
        }
        if (membership != null && Boolean.TRUE.equals(membership.getAutoRenewalEnabled())) {
            MandateInfo mandate = mandate(membership, instituteId);
            if (mandate != null && MandateInfo.STATUS_ACTIVE.equalsIgnoreCase(mandate.getStatus())
                    && mandate.getMaxAmount() != null
                    && price.compareTo(BigDecimal.valueOf(mandate.getMaxAmount())) > 0) {
                return "The learner's autopay covers up to " + plain(BigDecimal.valueOf(mandate.getMaxAmount()))
                        + " per charge, so " + plain(price) + " would be declined. Ask them to set up autopay again,"
                        + " or leave the renewal price unticked.";
            }
        }
        return null;
    }

    /**
     * The plan to charge {@code price} on: {@code basePlan} itself, a matching ACTIVE plan of its
     * payment option, an earlier custom plan, or a new private one.
     */
    @Transactional
    public PaymentPlan findOrCreate(PaymentPlan basePlan, BigDecimal price, String invoiceNumber) {
        BigDecimal target = price.setScale(2, RoundingMode.HALF_UP);
        if (samePrice(basePlan, target)) {
            return basePlan;
        }
        PaymentOption option = basePlan.getPaymentOption();
        List<PaymentPlan> siblings = option != null ? paymentPlanRepository.findByPaymentOption(option) : List.of();
        Optional<PaymentPlan> existing = siblings.stream()
                .filter(p -> "ACTIVE".equalsIgnoreCase(p.getStatus())
                        || (STATUS_PRIVATE.equalsIgnoreCase(p.getStatus()) && TAG.equals(p.getTag())))
                .filter(p -> samePrice(p, target) && sameTerms(p, basePlan))
                // A real catalogue plan beats a custom one.
                .min(Comparator.comparing(p -> "ACTIVE".equalsIgnoreCase(p.getStatus()) ? 0 : 1));
        if (existing.isPresent()) {
            log.info("Renewal price {} for plan {}: reusing plan {} ({})", target, basePlan.getId(),
                    existing.get().getId(), existing.get().getStatus());
            return existing.get();
        }

        PaymentPlan plan = new PaymentPlan();
        // Same name as the plan it is based on: learners see it on their membership, receipts and
        // reminders, where "Yearly" reads right and an internal suffix does not. The status, tag
        // and description mark it as a custom plan for admins and reports.
        plan.setName(StringUtils.hasText(basePlan.getName()) ? basePlan.getName() : "Plan");
        plan.setStatus(STATUS_PRIVATE);
        plan.setTag(TAG);
        plan.setActualPrice(target.doubleValue());
        plan.setElevatedPrice(target.doubleValue());
        plan.setCurrency(basePlan.getCurrency());
        plan.setValidityInDays(basePlan.getValidityInDays());
        plan.setFeatureJson(basePlan.getFeatureJson());
        plan.setMemberCount(basePlan.getMemberCount());
        plan.setPlanChangeAllowed(basePlan.getPlanChangeAllowed());
        plan.setDescription("Custom price from invoice " + invoiceNumber + " (based on plan " + basePlan.getId() + ")");
        plan.setPaymentOption(option);
        plan = paymentPlanRepository.save(plan);
        log.info("Created private plan {} at {} {} for invoice {} (based on plan {})", plan.getId(), target,
                plan.getCurrency(), invoiceNumber, basePlan.getId());
        return plan;
    }

    private MandateInfo mandate(UserPlan membership, String instituteId) {
        String vendor = membership.getEnrollInvite() != null ? membership.getEnrollInvite().getVendor() : null;
        if (!StringUtils.hasText(vendor)) {
            return null;
        }
        try {
            return mandateService.getMandate(membership.getUserId(), instituteId, vendor, membership.getId());
        } catch (Exception e) {
            log.warn("Could not read the mandate of membership {}: {}", membership.getId(), e.getMessage());
            return null;
        }
    }

    private static boolean samePrice(PaymentPlan plan, BigDecimal price) {
        return plan != null && BigDecimal.valueOf(plan.getActualPrice()).compareTo(price) == 0;
    }

    private static boolean sameTerms(PaymentPlan candidate, PaymentPlan base) {
        boolean sameValidity = java.util.Objects.equals(candidate.getValidityInDays(), base.getValidityInDays());
        boolean sameCurrency = !StringUtils.hasText(base.getCurrency())
                || base.getCurrency().equalsIgnoreCase(candidate.getCurrency());
        return sameValidity && sameCurrency;
    }

    private static String plain(BigDecimal amount) {
        return amount.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}
