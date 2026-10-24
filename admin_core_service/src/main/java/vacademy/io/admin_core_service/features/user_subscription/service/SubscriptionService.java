package vacademy.io.admin_core_service.features.user_subscription.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.user_subscription.util.PlanValidityResolver;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService.VendorInfo;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService;
import vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo;
import vacademy.io.admin_core_service.features.user_subscription.dto.SubscriptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Learner self-service for subscriptions + autopay mandates: list the learner's
 * subscriptions and cancel autopay. Cancelling revokes the mandate and stops
 * future charges but NEVER cuts access early — the learner keeps access until
 * end_date (status CANCELED makes the enrolment processor expire exactly at
 * end_date, no grace). All operations are scoped to the JWT user id.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubscriptionService {

    private final UserPlanRepository userPlanRepository;
    private final UserInstitutePaymentGatewayMappingService mandateService;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final WorkflowTriggerService workflowTriggerService;
    private final vacademy.io.admin_core_service.features.payments.service.PaymentService paymentService;
    private final vacademy.io.admin_core_service.features.auth_service.service.AuthService authService;
    private final PlanChangeService planChangeService;
    private final vacademy.io.admin_core_service.features.payments.service.MandateRequestDefaults mandateRequestDefaults;
    private final vacademy.io.admin_core_service.features.enrollment_policy.service.RenewalPaymentService renewalPaymentService;
    private final vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository paymentLogRepository;
    private final InstitutePaymentGatewayMappingService institutePaymentGatewayMappingService;
    private final vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService paymentSettingService;
    private final vacademy.io.admin_core_service.features.payments.manager.EwayPaymentManager ewayPaymentManager;
    private final vacademy.io.admin_core_service.features.institute.repository.InstituteRepository instituteRepository;
    private final PaymentLogService paymentLogService;


    /**
     * Reported back when the learner must finish paying on the gateway's own hosted page.
     * Nothing has been charged; {@code redirectUrl} in the same block is where to send them.
     */
    public static final String RENEWAL_REDIRECT = "REDIRECT";

    /**
     * How long a just-submitted manual renewal blocks another one for the same plan. Only
     * has to cover a double-click / impatient retry, because a stored-token charge settles
     * within a second or two.
     */
    private static final long DUPLICATE_RENEWAL_WINDOW_SECONDS = 120;

    private static final List<String> VISIBLE_STATUSES = List.of(
            UserPlanStatusEnum.ACTIVE.name(),
            UserPlanStatusEnum.CANCELED.name(),
            UserPlanStatusEnum.PAYMENT_FAILED.name(),
            // Dunning-expired plans stay visible so the learner can pay manually
            // and reactivate the same membership (renewal payment flow).
            UserPlanStatusEnum.EXPIRED.name());

    public List<SubscriptionDTO> listSubscriptions(String userId, String instituteId) {
        List<UserPlan> plans = userPlanRepository.findAllByUserIdAndInstituteIdAndStatusIn(
                userId, instituteId, VISIBLE_STATUSES);
        plans = collapseUnfinishedSignups(plans);
        // Read the institute's gateways ONCE for the whole list, not once per plan: this is
        // the learner's entire membership list and the mapping is the same for every row.
        List<VendorInfo> activeGateways = institutePaymentGatewayMappingService
                .getAllVendorsForInstitute(instituteId);
        return plans.stream().map(p -> toDto(p, userId, instituteId, activeGateways)).toList();
    }

    /**
     * Cancel autopay for a plan. Revokes the mandate, turns off auto-renewal and
     * marks the plan CANCELED (access continues until end_date). Idempotent.
     */
    @Transactional
    public SubscriptionDTO cancelSubscription(String userId, String instituteId, String userPlanId) {
        UserPlan plan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new VacademyException("Subscription not found: " + userPlanId));
        if (!userId.equals(plan.getUserId())) {
            throw new VacademyException("Subscription does not belong to the current user");
        }

        String vendor = resolveVendor(plan);
        if (StringUtils.hasText(vendor)) {
            mandateService.revokeMandate(userId, instituteId, vendor, userPlanId);
        }

        plan.setAutoRenewalEnabled(false);
        plan.setStatus(UserPlanStatusEnum.CANCELED.name());
        userPlanRepository.save(plan);
        log.info("Cancelled autopay for plan {} (user {}); access retained until {}",
                userPlanId, userId, plan.getEndDate());

        // Same SUBSCRIPTION_CANCELLED trigger the admin cancel path fires
        // (UserPlanService.cancelUserPlan) so cancel-reaction workflows cover
        // learner self-service too. Wrapped so a workflow failure can't undo the cancel.
        try {
            Map<String, Object> ctx = new HashMap<>();
            ctx.put("userPlanId", plan.getId());
            ctx.put("userId", plan.getUserId());
            ctx.put("enrollInviteId", plan.getEnrollInviteId());
            ctx.put("paymentPlanId", plan.getPaymentPlanId());
            ctx.put("endDate", plan.getEndDate() != null ? plan.getEndDate().toString() : null);
            ctx.put("selfService", true);
            String eventId = plan.getEnrollInviteId() != null ? plan.getEnrollInviteId() : instituteId;
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.SUBSCRIPTION_CANCELLED.name(), eventId, instituteId, ctx);
        } catch (Exception wfe) {
            log.warn("Failed to trigger SUBSCRIPTION_CANCELLED workflow for plan {}: {}",
                    userPlanId, wfe.getMessage());
        }

        return toDto(plan, userId, instituteId,
                institutePaymentGatewayMappingService.getAllVendorsForInstitute(instituteId));
    }

    /** The plan the next renewal charges (a booked plan change's target, else the current one) has a price. */
    private boolean hasPayablePrice(UserPlan plan) {
        var pendingTarget = planChangeService.pendingTargetPlan(plan);
        return isPayable(pendingTarget != null ? pendingTarget : plan.getPaymentPlan());
    }

    private static boolean isPayable(
            vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan payablePlan) {
        return payablePlan != null && payablePlan.getActualPrice() > 0;
    }

    private SubscriptionDTO toDto(UserPlan plan, String userId, String instituteId,
            List<VendorInfo> activeGateways) {
        String vendor = resolveVendor(plan);
        MandateInfo mandate = StringUtils.hasText(vendor)
                ? mandateService.getMandate(userId, instituteId, vendor, plan.getId())
                : null;
        boolean liveMandate = mandate != null
                && MandateInfo.STATUS_ACTIVE.equalsIgnoreCase(mandate.getStatus());

        List<String> packageSessionIds = mappingRepository
                .findByUserPlanIdAndStatus(plan.getId(), LearnerSessionStatusEnum.ACTIVE.name())
                .stream()
                .map(StudentSessionInstituteGroupMapping::getPackageSession)
                .filter(ps -> ps != null)
                .map(ps -> ps.getId())
                .distinct()
                .toList();
        // What the learner is enrolled in, for plan-change purposes: an expired membership
        // has no ACTIVE mapping, and passing an empty list makes the resolver return no
        // targets, which hid "Change plan" from precisely the learners who need it. The DTO
        // keeps reporting only the ACTIVE ones -- that is what "currently enrolled" means.
        List<String> changeablePackageSessionIds = packageSessionIds.isEmpty()
                ? planChangeService.packageSessionIdsForChange(plan.getId())
                : packageSessionIds;

        // Manual renewal is offered whenever autopay will NOT charge this plan:
        // cancelled/failed/expired plans, an active plan whose mandate is gone, a plan
        // in dunning (a charge was presented and refused — renewal_attempt_count is
        // reset to 0 only by a successful renewal), or a plan whose period has already
        // ended without a renewal. The last two matter because our mandate record is
        // never read back from the gateway: a learner whose UPI mandate was cancelled
        // at the bank still shows a "live" mandate here, and on 2026-09-21 seventeen
        // members who had been told to pay could see only "Stop auto-pay".
        boolean inDunning = plan.getRenewalAttemptCount() != null && plan.getRenewalAttemptCount() > 0;
        boolean lapsed = plan.getEndDate() != null && plan.getEndDate().before(new java.util.Date());
        boolean renewalDue = !liveMandate
                || inDunning
                || lapsed
                || UserPlanStatusEnum.CANCELED.name().equals(plan.getStatus())
                || UserPlanStatusEnum.PAYMENT_FAILED.name().equals(plan.getStatus())
                || UserPlanStatusEnum.EXPIRED.name().equals(plan.getStatus());
        // ...and only if a gateway can actually take the payment. Resolved the same way the
        // payment itself will resolve it -- the plan's own vendor when the institute still has
        // that gateway, else the institute's configured one -- so the button is offered exactly
        // when it will work. Before this gate it was offered for every vendor: Vet Education's
        // learner plans carry four different invite vendors (EWAY, STRIPE, RAZORPAY, PHONEPE)
        // while the institute has only eWay configured, so most of the non-eWay ones could
        // never have completed.
        VendorInfo renewalGateway = resolveRenewalGateway(plan, activeGateways);
        // ...and only on a plan that was genuinely a membership. Every abandoned or failed
        // first checkout leaves its own plan row behind (one learner produced four in seven
        // minutes), and those rows satisfy every condition above — lapsed, no live mandate,
        // PAYMENT_FAILED — so the page offered "pay to continue" on a dead signup attempt.
        // Renewing one takes the money and extends access that was never granted: on
        // 2026-10-04 a learner paid Rs 7,200 against such a row and ended up enrolled in
        // nothing. A renewal extends an existing membership, so require one to exist.
        boolean unfinishedSignup = isUnfinishedSignup(plan);
        // ...and only when there is a price to pay. A free or unpriced plan (e.g. an imported
        // course with no payment plan) used to show "Pay to continue", and pressing it came back
        // 510 "Subscription has no payable plan price" -- the same check initiateRenewalPayment
        // makes, applied here so the button is never offered for a payment that cannot start.
        boolean canRenewManually = !unfinishedSignup && renewalDue && renewalGateway != null
                && hasPayablePrice(plan);
        String currency = RegionalPriceLock
                .currency(plan, mandate != null && mandate.getCurrency() != null
                        ? mandate.getCurrency()
                        : (plan.getEnrollInvite() != null ? plan.getEnrollInvite().getCurrency() : null));

        var planChange = planChangeSummary(plan, instituteId, changeablePackageSessionIds);

        return SubscriptionDTO.builder()
                .userPlanId(plan.getId())
                .planName(plan.getPaymentPlan() != null ? plan.getPaymentPlan().getName() : null)
                .status(plan.getStatus())
                .endDate(plan.getEndDate())
                .nextChargeAt(plan.getNextChargeAt())
                .autoRenewalEnabled(plan.getAutoRenewalEnabled())
                .isTrial(plan.getIsTrial())
                .vendor(vendor)
                .mandateStatus(mandate != null ? mandate.getStatus() : null)
                .mandateMaxAmount(mandate != null ? mandate.getMaxAmount() : null)
                .currency(currency)
                .hasActiveMandate(liveMandate)
                .packageSessionIds(packageSessionIds)
                .planPrice(plan.getPaymentPlan() != null
                        ? RegionalPriceLock.listPrice(plan)
                        : null)
                // Same resolver the renewal uses to extend end_date, so the period the
                // learner is shown is the period they are actually charged for.
                .planValidityDays(PlanValidityResolver.resolveValidityDays(plan))
                .supportEmail(resolveSupportEmail(instituteId).orElse(null))
                .vendorId(plan.getEnrollInvite() != null ? plan.getEnrollInvite().getVendorId() : null)
                .canRenewManually(canRenewManually)
                .canCompleteEnrollment(unfinishedSignup)
                .enrollInviteCode(plan.getEnrollInvite() != null
                        ? plan.getEnrollInvite().getInviteCode()
                        : null)
                .instantRenewal(renewalGateway != null && isStoredTokenGateway(renewalGateway.getVendor()))
                .renewalVendor(renewalGateway != null ? renewalGateway.getVendor() : null)
                .autopayDefault(autopayDefaultOnRenewal(instituteId))
                .autopayAvailable(isAutopayAvailable(plan))
                .canChangePlan(planChange.canChangePlan())
                .scheduledPlanChange(planChange.scheduledChange())
                .build();
    }

    /**
     * The institute's utility-email address, for "questions about your renewal" on the
     * subscriptions screen.
     *
     * <p>Prefers {@code UTILITY_EMAIL.verification_identity} — the bare address SES was
     * verified against — and falls back to {@code UTILITY_EMAIL.from}, which is usually
     * written as {@code "Display Name <address@x>"} and has to be unwrapped. Same block
     * DoubtNotificationService resolves its sender from.
     *
     * <p>Empty rather than a platform default on any failure: showing one institute's
     * support address to another institute's learner is worse than showing none, and the
     * screen drops the line when this is absent.
     */
    private java.util.Optional<String> resolveSupportEmail(String instituteId) {
        try {
            var institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null || !StringUtils.hasText(institute.getSetting())) {
                return java.util.Optional.empty();
            }
            var utility = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(institute.getSetting())
                    .path("setting").path("EMAIL_SETTING").path("data").path("UTILITY_EMAIL");

            String identity = utility.path("verification_identity").asText("").trim();
            if (identity.contains("@")) {
                return java.util.Optional.of(identity);
            }
            String from = utility.path("from").asText("").trim();
            if (from.isEmpty()) {
                return java.util.Optional.empty();
            }
            int lt = from.indexOf('<');
            int gt = from.indexOf('>');
            if (lt >= 0 && gt > lt + 1) {
                return java.util.Optional.of(from.substring(lt + 1, gt).trim());
            }
            return from.contains("@") ? java.util.Optional.of(from) : java.util.Optional.empty();
        } catch (Exception e) {
            log.warn("Could not resolve support email for institute {}: {}", instituteId, e.getMessage());
            return java.util.Optional.empty();
        }
    }

    /**
     * Plan-change state for one membership. Best-effort: a failure here must degrade to
     * "no switching offered", never take down the whole subscriptions list — this endpoint
     * is what the learner's membership card renders from.
     */
    private PlanChangeService.PlanChangeSummary planChangeSummary(UserPlan plan, String instituteId,
            List<String> packageSessionIds) {
        try {
            return planChangeService.summarise(plan, instituteId, packageSessionIds);
        } catch (Exception e) {
            // ERROR with the stack trace, deliberately: degrading to "no switching offered"
            // makes a genuine failure look identical to "correctly not eligible", and that
            // ambiguity has already cost a debugging session. The card still renders.
            log.error("Could not resolve plan-change eligibility for plan {} (institute {}) — "
                    + "reporting not-eligible", plan.getId(), instituteId, e);
            return new PlanChangeService.PlanChangeSummary(false, null);
        }
    }

    /** Whether the plan's invite has autopay configured (AUTOPAY_SETTING.ENABLED). */
    private boolean isAutopayAvailable(UserPlan plan) {
        if (plan.getEnrollInvite() == null || !StringUtils.hasText(plan.getEnrollInvite().getSettingJson())) {
            return false;
        }
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(plan.getEnrollInvite().getSettingJson())
                    .path("setting").path("AUTOPAY_SETTING").path("ENABLED").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * One unfinished signup, not several memberships. Each abandoned or failed checkout attempt
     * leaves its own plan row — one learner produced four inside seven minutes, and every one of
     * them lands in a VISIBLE_STATUSES state. Listing them all would show the learner four
     * identical "complete your enrollment" cards for a single thing they never finished. Keep
     * the most recent attempt (the one they were last on) and drop the older ones; real
     * memberships are never collapsed, however many there are.
     */
    private List<UserPlan> collapseUnfinishedSignups(List<UserPlan> plans) {
        List<UserPlan> unfinished = plans.stream().filter(this::isUnfinishedSignup).toList();
        if (unfinished.isEmpty()) {
            return plans;
        }
        boolean hasRealMembership = unfinished.size() < plans.size();
        if (hasRealMembership) {
            // They have an actual membership in the list, so the action they need is on THAT
            // row — "pay to continue" when it has lapsed. Keeping the leftover signup rows
            // would sit a "complete your enrollment" card next to it and invite the learner to
            // start a second membership. It is also what would otherwise happen the moment
            // they DO complete one: the dead row outlives the enrolment and keeps asking.
            return plans.stream().filter(p -> !isUnfinishedSignup(p)).toList();
        }
        if (unfinished.size() == 1) {
            return plans;
        }
        // No membership at all — show the one unfinished signup they were last on. Each retried
        // checkout leaves its own row (one learner produced four inside seven minutes), and
        // listing them all would show four identical cards for one thing never finished.
        UserPlan newest = unfinished.stream()
                .max(Comparator.comparing(UserPlan::getCreatedAt,
                        Comparator.nullsFirst(Comparator.naturalOrder())))
                .orElse(null);
        log.info("Collapsing {} unfinished signup rows for the subscriptions list, keeping {}",
                unfinished.size(), newest != null ? newest.getId() : null);
        final UserPlan keep = newest;
        return plans.stream().filter(p -> p == keep).toList();
    }

    /**
     * Whether this plan row ever represented a real membership, as opposed to an abandoned or
     * failed checkout attempt. Two independent pieces of evidence, either of which is enough:
     * an enrolment was created against it at some point (any status, since a trial's mappings
     * are revoked when it ends), or a payment on it succeeded.
     *
     * <p>Verified against production before being made a gate: all eight SuchBliss learners
     * who have successfully used "pay to continue" satisfy it, so the button stays exactly
     * where it works today.
     */
    private boolean everWasAMembership(UserPlan plan) {
        // existsRealEnrollmentForPlan, NOT "has any mapping": reaching the payment step stamps
        // the plan onto an INVITED row and an ABANDONED_CART row, so every abandoned checkout
        // carries mappings. Reading those as membership would leave the renewal button on a dead
        // signup and hide the complete-your-enrollment card from exactly the rows that need it.
        // Nitika's plan slipped the earlier version only because her Rs 1 failed before any row
        // was stamped -- the shape the system produces today would have sailed through.
        return mappingRepository.existsRealEnrollmentForPlan(plan.getId())
                || paymentLogRepository.existsByUserPlanIdAndPaymentStatus(
                        plan.getId(), PaymentStatusEnum.PAID.name());
    }

    /**
     * An unfinished checkout: a plan that never became a membership AND still sits in one of the
     * two states an incomplete checkout lands in.
     *
     * <p>The status test is the safety belt. "No mapping and no paid log" on its own also
     * describes legacy members created by direct-SQL migration (the MYCPD import brought in 939,
     * with no payment_log rows), and refusing THOSE learners a renewal would break paying members
     * at other institutes to fix a SuchBliss bug. A genuine abandoned or refused checkout is
     * PENDING_FOR_PAYMENT or PAYMENT_FAILED — the Nitika row was PAYMENT_FAILED — while a
     * migrated or lapsed member is CANCELED or EXPIRED and keeps its button whatever its
     * paperwork looks like.
     */
    private boolean isUnfinishedSignup(UserPlan plan) {
        boolean neverStartedState = UserPlanStatusEnum.PENDING_FOR_PAYMENT.name().equals(plan.getStatus())
                || UserPlanStatusEnum.PAYMENT_FAILED.name().equals(plan.getStatus());
        return neverStartedState && !everWasAMembership(plan);
    }

    /**
     * Start a MANUAL RENEWAL payment for the learner's existing plan ("pay to
     * continue"). Amount/vendor are SERVER-derived from the plan (never trusted
     * from the client). With {@code withAutopay} (allowed only when the invite
     * has AUTOPAY_SETTING.ENABLED) the checkout opens in mandate mode: the same
     * approval charges the price AND registers a fresh UPI Autopay/e-mandate,
     * so future cycles auto-deduct again.
     *
     * <p>Two shapes come back, and the caller branches on {@code response_data}:
     * a CHECKOUT gateway (Razorpay) returns order coordinates for the client to open,
     * and a HOSTED gateway (eWay) returns {@code paymentStatus: REDIRECT} with the
     * {@code redirectUrl} of the gateway's own card page. Nothing is charged either
     * way; the hosted leg finishes in {@link #completeHostedRenewal}.
     */
    public vacademy.io.common.payment.dto.PaymentResponseDTO initiateRenewalPayment(
            vacademy.io.common.auth.model.CustomUserDetails userDetails,
            String instituteId, String userPlanId, boolean withAutopay, String mandateMethod) {
        UserPlan plan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new VacademyException("Subscription not found: " + userPlanId));
        if (!userDetails.getUserId().equals(plan.getUserId())) {
            throw new VacademyException("Subscription does not belong to the current user");
        }
        if (plan.getEnrollInvite() == null) {
            throw new VacademyException("Subscription has no enrollment invite — cannot build payment");
        }
        // The UI stops offering this (toDto.canRenewManually), but the UI is not the gate: a
        // stale tab, a bookmarked link or a direct API call reaches here regardless, and this
        // is where the money is actually taken. Refuse to renew a plan that was never a
        // membership and send the learner to finish enrolling instead — paying here would
        // extend access that does not exist, which is how one learner's Rs 7,200 bought her a
        // plan running to 2027 with no batch, no class links and no WhatsApp.
        if (isUnfinishedSignup(plan)) {
            throw new VacademyException("This membership was never activated — please complete "
                    + "your enrollment instead of renewing");
        }
        // A booked downgrade takes effect at exactly this renewal, so the learner must be
        // quoted the plan they are moving TO — billing them the old price here would take
        // money for a plan they will not be on the moment the payment lands.
        var pendingTarget = planChangeService.pendingTargetPlan(plan);
        var payablePlan = pendingTarget != null ? pendingTarget : plan.getPaymentPlan();
        if (!isPayable(payablePlan)) {
            throw new VacademyException("Subscription has no payable plan price");
        }
        if (withAutopay && !isAutopayAvailable(plan)) {
            throw new VacademyException("Autopay is not enabled for this membership's invite");
        }
        var invite = plan.getEnrollInvite();
        List<vacademy.io.common.auth.dto.UserDTO> users =
                authService.getUsersFromAuthServiceByUserIds(List.of(plan.getUserId()));
        if (users.isEmpty()) {
            throw new VacademyException("Learner account not found");
        }
        var user = users.get(0);

        var request = new vacademy.io.common.payment.dto.PaymentInitiationRequestDTO();
        // Renewing the same plan keeps a regionally priced member on their locked price.
        boolean regionalRenewal = pendingTarget == null
                && RegionalPriceLock.isLocked(plan);
        double payableAmount = regionalRenewal
                ? RegionalPriceLock.listPrice(plan)
                : payablePlan.getActualPrice();
        request.setAmount(payableAmount);
        // Invite currency first, then the PLAN's own currency, and only then INR. Vet
        // Education has invites with a blank currency (e.g. "Individual Membership",
        // 82725a60) whose plan is priced in AUD -- falling straight back to INR there would
        // charge an Australian member in rupees, and scale the minor units by the wrong
        // exponent on the way. It is also why that plan's button reads "Pay 192" with no
        // currency at all.
        request.setCurrency(regionalRenewal ? plan.getRegionalCurrency() : resolveCurrency(invite, payablePlan));
        request.setDescription("Membership renewal — "
                + (payablePlan.getName() != null ? payablePlan.getName() : "subscription"));
        request.setInstituteId(instituteId);
        request.setEmail(user.getEmail());
        // Resolved exactly as toDto gated the button, so a plan offered a renewal is never
        // then refused one.
        VendorInfo gateway = resolveRenewalGateway(plan,
                institutePaymentGatewayMappingService.getAllVendorsForInstitute(instituteId));
        if (gateway == null) {
            throw new VacademyException(
                    "This institute has no payment gateway that can take a renewal — please contact support");
        }
        String vendor = gateway.getVendor();
        request.setVendor(vendor);
        request.setVendorId(gateway.getVendorId());
        request.setPaymentType(vacademy.io.common.payment.enums.PaymentType.RENEWAL);

        // Whether this renewal also arms autopay. Two rules, and the gateway decides which:
        //
        //  - CHECKOUT gateway (Razorpay): the learner's own request, or the institute default.
        //  - STORED-TOKEN gateway (eWay): ONLY the institute default. A client-sent withAutopay
        //    is ignored here by design. These learners are never shown a checkbox (there is no
        //    mandate to register), so such a flag can only be spurious -- and on a gateway
        //    holding a card on file, honouring a spurious one would start charging somebody
        //    automatically who never asked. That makes the institute setting the single switch
        //    for card-on-file autopay, which is what "no eWay auto-renewal until we say so"
        //    requires: one place to turn it on, and no client able to bypass it.
        //
        // Either way the invite's own AUTOPAY_SETTING still gates it, and failing that is
        // silently ignored rather than an error -- an institute-wide default must not force
        // recurring billing onto a product never configured for it.
        boolean autopayRequested = isStoredTokenGateway(vendor)
                ? autopayDefaultOnRenewal(instituteId)
                : (withAutopay || autopayDefaultOnRenewal(instituteId));
        boolean armAutopay = autopayRequested && isAutopayAvailable(plan);
        if (withAutopay && isStoredTokenGateway(vendor) && !armAutopay) {
            log.info("Plan {}: ignoring withAutopay on stored-token gateway {} — autopay there "
                    + "is controlled by the institute setting only", plan.getId(), vendor);
        }

        // Stored-token gateway (eWay): the learner's card is already tokenised at the gateway
        // under their TokenCustomerID, so there is nothing for a checkout to collect and no
        // mandate to register -- their click IS the authorisation for this one amount. Charge
        // the token server-side and confirm inline. This whole branch used to be missing:
        // the request carried only a RazorpayRequestDTO, so EwayPaymentManager dereferenced a
        // null ewayRequest and every "Pay to continue" on eWay threw an NPE.
        if (isStoredTokenGateway(vendor)) {
            return startHostedCheckoutRenewal(plan, instituteId, request, user, armAutopay);
        }

        var razorpayRequest = new vacademy.io.common.payment.dto.RazorpayRequestDTO();
        razorpayRequest.setContact(user.getMobileNumber());
        razorpayRequest.setEmail(user.getEmail());
        request.setRazorpayRequest(razorpayRequest);

        if (armAutopay) {
            // Mandate-mode checkout: charge + register a fresh recurring mandate. The
            // mandate fields must be filled here just as enrolment fills them — an empty
            // RazorpayRequestDTO makes the gateway fall back to a CARD e-mandate with no
            // ceiling, which is wrong for a learner who authorised UPI Autopay.
            if (regionalRenewal) {
                mandateRequestDefaults.applyMaxAmountAndFrequency(request, invite, payableAmount);
            } else {
                // Not regionally priced: exactly the original call.
                mandateRequestDefaults.applyMaxAmountAndFrequency(request, invite, payablePlan);
            }
            mandateRequestDefaults.applyMethod(request, mandateMethod,
                    plan.getUserId(), instituteId, invite.getVendor());
            return paymentService.handleMandatePayment(user, instituteId, invite, plan, request);
        }
        return paymentService.handleUserPlanPayment(request, instituteId, userDetails, userPlanId);
    }

    /**
     * "Pay to continue" on a gateway with a hosted card page (eWay Responsive Shared Page).
     * Raises the order, asks eWay for a hosted session, and hands the client the URL to send
     * the learner to. Nothing is charged here and no card is ever posted to us -- the number
     * and CVN are entered on eWay's page. {@link #completeHostedRenewal} finishes the job
     * when the learner is redirected back.
     */
    private vacademy.io.common.payment.dto.PaymentResponseDTO startHostedCheckoutRenewal(
            UserPlan plan, String instituteId,
            PaymentInitiationRequestDTO request,
            vacademy.io.common.auth.dto.UserDTO user,
            boolean withAutopay) {

        String vendor = request.getVendor();

        // Double-submit guard. A checkout gateway is self-limiting (a second click just opens
        // a modal the learner abandons), but this charge is submitted server-side and settles
        // immediately, so a second click would take a second real payment. Per-log dedupe
        // cannot catch it: each click mints its own payment_log id.
        long recentAttempts = paymentLogRepository.countRecentUnfailedForPlan(
                plan.getId(),
                java.time.LocalDateTime.now().minusSeconds(DUPLICATE_RENEWAL_WINDOW_SECONDS),
                PaymentStatusEnum.FAILED.name());
        if (recentAttempts > 0) {
            throw new VacademyException("A payment for this membership was just submitted. "
                    + "Please refresh the page before trying again.");
        }

        // The learner always goes through the gateway's own hosted checkout, even when a card
        // is on file. Charging a saved card the instant the button is pressed gives them no
        // moment to confirm and no sight of which card is billed -- it reads as money
        // vanishing by magic. It is also the difference between a hijacked session being able
        // to spend someone's stored card and not: on the hosted page the attacker would have
        // to supply a card of their own, and the number and CVN never touch us at all.

        // Autopay is armed only once the money actually lands -- see completeHostedRenewal.
        // Arming it here would leave a learner who abandoned the hosted page signed up for
        // recurring billing they never paid for.

        // The payment_log is raised FIRST so the order exists before the learner leaves for
        // eWay: its id is what the redirect comes back with, and what reconciles an abandoned
        // return later.
        String orderId = paymentLogService.createPaymentLog(
                user.getId(), request.getAmount(), vendor, request.getVendorId(),
                request.getCurrency(), plan, null);
        request.setOrderId(orderId);

        Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);
        String returnBase = learnerPortalBase(instituteId);
        // Both ids travel in the return URL: the order to confirm, and the plan it belongs to
        // (the confirm endpoint checks the two agree AND that the caller owns the plan, so a
        // learner editing these parameters cannot reach anybody else's payment).
        String returnUrl = returnBase + "/subscriptions/payment-return?orderId=" + orderId
                + "&userPlanId=" + plan.getId();
        var shared = ewayPaymentManager.createSharedAccessCode(
                request, user, returnUrl, returnUrl + "&cancelled=true", gatewayData);

        // Remember the access code against the order so the result can still be read if the
        // learner never makes it back to the redirect URL.
        paymentLogService.updatePaymentLog(orderId, PaymentLogStatusEnum.ACTIVE.name(),
                PaymentStatusEnum.PAYMENT_PENDING.name(),
                JsonUtil.toJson(Map.of("ewayAccessCode", shared.AccessCode,
                        "autopayOnSuccess", withAutopay)));

        Map<String, Object> data = new HashMap<>();
        data.put("paymentStatus", RENEWAL_REDIRECT);
        data.put("redirectUrl", shared.SharedPaymentUrl);
        data.put("orderId", orderId);
        data.put("amount", request.getAmount());
        data.put("currency", request.getCurrency());
        var response = new vacademy.io.common.payment.dto.PaymentResponseDTO();
        response.setOrderId(orderId);
        response.setResponseData(data);

        log.info("Hosted checkout opened for plan {} (order {}, accessCode {})",
                plan.getId(), orderId, shared.AccessCode);
        return response;
    }

    /**
     * Finishes a renewal the learner paid for on the gateway's hosted page.
     *
     * <p>Called when they are redirected back. The outcome is read from the GATEWAY, never
     * from the redirect's query string -- a learner can edit that URL, so trusting it would
     * let anyone mark their own renewal paid. Idempotent: the confirmation claims the
     * payment_log exactly once, so a refresh of the return page cannot extend twice.
     */
    public vacademy.io.common.payment.dto.PaymentResponseDTO completeHostedRenewal(
            vacademy.io.common.auth.model.CustomUserDetails userDetails,
            String instituteId, String userPlanId, String orderId) {

        UserPlan plan = ownPlan(userDetails, userPlanId);
        var paymentLog = paymentLogRepository.findById(orderId)
                .orElseThrow(() -> new VacademyException("Payment not found: " + orderId));
        if (paymentLog.getUserPlan() == null || !plan.getId().equals(paymentLog.getUserPlan().getId())) {
            throw new VacademyException("That payment does not belong to this subscription");
        }

        String accessCode = readAccessCode(paymentLog);
        if (!StringUtils.hasText(accessCode)) {
            throw new VacademyException("This payment has no hosted checkout to confirm");
        }

        String vendor = paymentLog.getVendor();
        Map<String, Object> gatewayData = institutePaymentGatewayMappingService
                .findInstitutePaymentGatewaySpecifData(vendor, instituteId);
        var result = ewayPaymentManager.getSharedAccessCodeResult(accessCode, gatewayData);

        boolean paid = result != null && Boolean.TRUE.equals(result.TransactionStatus);
        Map<String, Object> data = new HashMap<>();
        data.put("paymentStatus", paid ? PaymentStatusEnum.PAID.name() : PaymentStatusEnum.FAILED.name());
        data.put("orderId", orderId);
        if (result != null) {
            data.put("transactionId", result.TransactionID);
            data.put("reason", result.ResponseMessage);
        }

        if (paid) {
            // Autopay only now, and only if it was asked for when the checkout was opened.
            if (readAutopayOnSuccess(paymentLog) && !Boolean.TRUE.equals(plan.getAutoRenewalEnabled())
                    && isAutopayAvailable(plan)) {
                plan.setAutoRenewalEnabled(true);
                userPlanRepository.save(plan);
            }
            var confirmation = new vacademy.io.common.payment.dto.PaymentResponseDTO();
            confirmation.setOrderId(orderId);
            confirmation.setResponseData(data);
            renewalPaymentService.handleRenewalPaymentConfirmation(
                    orderId, instituteId, PaymentStatusEnum.PAID, confirmation);
            log.info("Hosted renewal confirmed for plan {} (order {})", plan.getId(), orderId);
        } else {
            paymentLogService.updatePaymentLog(orderId, PaymentLogStatusEnum.FAILED.name(),
                    PaymentStatusEnum.FAILED.name(), JsonUtil.toJson(data));
            log.warn("Hosted renewal NOT paid for plan {} (order {}): {}", plan.getId(), orderId,
                    result == null ? "no result" : result.ResponseMessage);
        }

        var response = new vacademy.io.common.payment.dto.PaymentResponseDTO();
        response.setOrderId(orderId);
        response.setResponseData(data);
        return response;
    }

    /** The access code stashed on the log when the hosted checkout was opened. */
    private String readAccessCode(vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog paymentLog) {
        try {
            var node = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(paymentLog.getPaymentSpecificData());
            return node.path("ewayAccessCode").asText(null);
        } catch (Exception e) {
            return null;
        }
    }

    /** Whether the learner asked for autopay when they opened the checkout. */
    private boolean readAutopayOnSuccess(vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog paymentLog) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(paymentLog.getPaymentSpecificData())
                    .path("autopayOnSuccess").asBoolean(false);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Where to send the learner back to. Institute values are inconsistent -- some carry the
     * scheme, some are a bare host, some have a trailing slash -- so normalise before
     * appending a path or eWay is handed a URL it will refuse.
     */
    private String learnerPortalBase(String instituteId) {
        String base = instituteRepository.findById(instituteId)
                .map(vacademy.io.common.institute.entity.Institute::getLearnerPortalBaseUrl)
                .orElse(null);
        if (!StringUtils.hasText(base)) {
            throw new VacademyException(
                    "This institute has no learner portal URL configured — cannot return from checkout");
        }
        base = base.trim();
        if (!base.startsWith("http://") && !base.startsWith("https://")) {
            base = "https://" + base;
        }
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }

    /**
     * Whether this institute arms autopay on a manual renewal by default. Best-effort: a
     * failure to read the setting must degrade to "no autopay", never to charging a member
     * on a recurring basis they did not ask for.
     */
    private boolean autopayDefaultOnRenewal(String instituteId) {
        try {
            return paymentSettingService.isAutopayDefaultOnManualRenewal(instituteId);
        } catch (Exception e) {
            log.warn("Could not read the autopay-on-renewal default for institute {} — "
                    + "treating as off: {}", instituteId, e.getMessage());
            return false;
        }
    }

    /** Currency for a renewal: the invite's, else the plan's own, else INR. */
    private String resolveCurrency(vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite invite,
            vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan plan) {
        if (invite != null && StringUtils.hasText(invite.getCurrency())) {
            return invite.getCurrency();
        }
        if (plan != null && StringUtils.hasText(plan.getCurrency())) {
            return plan.getCurrency();
        }
        return "INR";
    }

    /**
     * The gateway a manual renewal will actually go through, or null when none can.
     *
     * <p>Order is the plan's own vendor first, then the institute's configured gateway. The
     * plan's vendor is only honoured when the institute STILL has that gateway active,
     * because an invite naming a gateway the institute cannot transact on is dead data, not
     * an instruction: Vet Education's learner plans carry EWAY, STRIPE, RAZORPAY and PHONEPE
     * invites while eWay is the only gateway it has credentials for, so ~70 members would
     * otherwise be stuck holding a vendor nobody can charge. Falling back to the institute
     * level is what makes those pay normally.
     *
     * <p>Among several configured gateways a stored-token one wins, so a learner with a card
     * already on file pays in one tap instead of being sent through a checkout.
     */
    private VendorInfo resolveRenewalGateway(UserPlan plan, List<VendorInfo> activeGateways) {
        if (activeGateways == null || activeGateways.isEmpty()) {
            return null;
        }
        PaymentGateway planGateway = gatewayOrNull(resolveVendor(plan));
        if (planGateway != null) {
            for (VendorInfo candidate : activeGateways) {
                if (gatewayOrNull(candidate.getVendor()) == planGateway
                        && supportsManualRenewal(candidate.getVendor())) {
                    // Keep the invite's own vendorId here: for a gateway the plan was actually
                    // sold on it may carry a sub-merchant id that the institute-level mapping
                    // (which stores vendorId == vendor) does not know about.
                    String vendorId = plan.getEnrollInvite() != null
                            && StringUtils.hasText(plan.getEnrollInvite().getVendorId())
                                    ? plan.getEnrollInvite().getVendorId()
                                    : candidate.getVendorId();
                    return new VendorInfo(candidate.getVendor(), vendorId);
                }
            }
        }
        return activeGateways.stream()
                .filter(candidate -> supportsManualRenewal(candidate.getVendor()))
                .min(Comparator.comparingInt(
                        candidate -> isStoredTokenGateway(candidate.getVendor()) ? 0 : 1))
                .orElse(null);
    }

    /**
     * Gateways that charge a card already stored against the learner (card-on-file), so a
     * manual renewal needs neither a checkout nor a mandate registration. eWay is the only
     * one today: Razorpay mints a chargeable token only through a checkout, and Stripe has
     * no chargeRecurring implementation at all.
     */
    private boolean isStoredTokenGateway(String vendor) {
        return gatewayOrNull(vendor) == PaymentGateway.EWAY;
    }

    /** Whether "pay to continue" can actually complete on this gateway. */
    private boolean supportsManualRenewal(String vendor) {
        PaymentGateway gateway = gatewayOrNull(vendor);
        return gateway == PaymentGateway.EWAY || gateway == PaymentGateway.RAZORPAY;
    }

    /**
     * Vendor string to gateway, or null when unset or unrecognised. Deliberately lenient:
     * this runs while rendering the learner's membership list, where prod data includes an
     * 'ewway' typo that must not take the whole list down.
     */
    private PaymentGateway gatewayOrNull(String vendor) {
        if (!StringUtils.hasText(vendor)) {
            return null;
        }
        try {
            return PaymentGateway.fromString(vendor);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    // ── Plan change (learner self-service) ──────────────────────────────────
    //
    // All three go through ownPlan(): the user id comes from the JWT and is checked against
    // the plan, never taken from the request. Same rule as every other method here.

    public vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeOptionsDTO getPlanChangeOptions(
            vacademy.io.common.auth.model.CustomUserDetails userDetails, String instituteId, String userPlanId) {
        return planChangeService.getChangeOptions(ownPlan(userDetails, userPlanId), instituteId);
    }

    public vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeResponseDTO requestPlanChange(
            vacademy.io.common.auth.model.CustomUserDetails userDetails, String instituteId, String userPlanId,
            vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeRequestDTO request) {
        return planChangeService.requestChange(
                ownPlan(userDetails, userPlanId), instituteId, request, userDetails);
    }

    public void cancelScheduledPlanChange(vacademy.io.common.auth.model.CustomUserDetails userDetails,
            String instituteId, String userPlanId) {
        planChangeService.cancelScheduledChange(ownPlan(userDetails, userPlanId).getId());
    }

    /** Loads a plan and refuses it unless it belongs to the caller. */
    private UserPlan ownPlan(vacademy.io.common.auth.model.CustomUserDetails userDetails, String userPlanId) {
        UserPlan plan = userPlanRepository.findById(userPlanId)
                .orElseThrow(() -> new VacademyException("Subscription not found: " + userPlanId));
        if (userDetails == null || !userDetails.getUserId().equals(plan.getUserId())) {
            throw new VacademyException("Subscription does not belong to the current user");
        }
        return plan;
    }

    private String resolveVendor(UserPlan plan) {
        if (plan.getEnrollInvite() != null && StringUtils.hasText(plan.getEnrollInvite().getVendor())) {
            return plan.getEnrollInvite().getVendor();
        }
        if (StringUtils.hasText(plan.getJsonPaymentDetails())) {
            try {
                PaymentInitiationRequestDTO req = JsonUtil.fromJson(
                        plan.getJsonPaymentDetails(), PaymentInitiationRequestDTO.class);
                if (req != null && StringUtils.hasText(req.getVendor())) {
                    return req.getVendor().toUpperCase();
                }
            } catch (Exception ignored) {
            }
        }
        return null;
    }
}
