package vacademy.io.admin_core_service.features.plan_change.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeOptionsDTO;
import vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeRequestDTO;
import vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeResponseDTO;
import vacademy.io.admin_core_service.features.plan_change.dto.PlanChangeTargetDTO;
import vacademy.io.admin_core_service.features.plan_change.dto.ScheduledPlanChangeDTO;
import vacademy.io.admin_core_service.features.plan_change.entity.UserPlanChangeRequest;
import vacademy.io.admin_core_service.features.plan_change.enums.PlanChangeDirection;
import vacademy.io.admin_core_service.features.plan_change.enums.PlanChangeEffectiveType;
import vacademy.io.admin_core_service.features.plan_change.enums.PlanChangeStatus;
import vacademy.io.admin_core_service.features.plan_change.repository.UserPlanChangeRequestRepository;
import vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.dto.RazorpayRequestDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.payment.enums.PaymentType;

import java.math.BigDecimal;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Moving a learner between payment plans without replacing their membership.
 *
 * <h2>Why the same user_plan row is kept</h2>
 *
 * The pre-existing way to change what a learner pays was cancel + re-enroll, which mints a
 * new {@code user_plan}. That breaks continuity: payment history, invoices and the account
 * ledger all hang off the plan id, and the enrollment mappings get rewritten. Here the row
 * is mutated in place — exactly as manual renewal already reactivates the same membership —
 * so a learner's billing history survives every upgrade and downgrade.
 *
 * <h2>Why a change needs its own record</h2>
 *
 * A change is not atomic. An UPGRADE has to survive a gateway round trip, and the gateway
 * hands back nothing but an order id — so the intent is written to
 * {@code user_plan_change_request} first, keyed by the payment log, and applied only when
 * the webhook confirms. A DOWNGRADE is deliberately deferred to the end of the paid cycle
 * (no refunds, no lost days), so it sits SCHEDULED until the renewal path picks it up.
 *
 * <p>{@link #applyChange} is the single writer for all three routes (paid upgrade, scheduled
 * downgrade, admin override), which is what stops the three from drifting apart.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PlanChangeService {

    private final UserPlanRepository userPlanRepository;
    private final UserPlanChangeRequestRepository changeRequestRepository;
    private final vacademy.io.admin_core_service.features.user_subscription.service.PaymentPlanService paymentPlanService;
    private final PlanChangeTargetResolver targetResolver;
    private final PlanChangeProrationCalculator prorationCalculator;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final EnrollInviteRepository enrollInviteRepository;
    private final PaymentLogRepository paymentLogRepository;
    private final PaymentLogService paymentLogService;
    private final vacademy.io.admin_core_service.features.payments.service.PaymentService paymentService;
    private final AuthService authService;
    private final UserAccountLedgerService userAccountLedgerService;
    private final InvoiceService invoiceService;
    private final WorkflowTriggerService workflowTriggerService;
    private final vacademy.io.admin_core_service.features.institute.service.setting.PaymentSettingService paymentSettingService;
    private final vacademy.io.admin_core_service.features.payments.service.MandateRequestDefaults mandateRequestDefaults;

    /**
     * Statuses from which a learner may initiate a change.
     *
     * <p>Includes the recovery states on purpose. A learner whose charge was refused, whose
     * grace ran out, or whose first checkout never completed is exactly the person who may
     * want to come back on a different plan, and hiding the option precisely then left
     * "Pay to continue" as the only way back. The pricing already handles them correctly:
     * a lapsed plan fails the trade-in test, so they pay the target's full price for its
     * full validity -- a re-purchase, not a discounted upgrade -- and applying the change
     * revives the mappings a previous expiry deactivated.
     */
    private static final List<String> CHANGEABLE_STATUSES = List.of(
            UserPlanStatusEnum.ACTIVE.name(),
            UserPlanStatusEnum.CANCELED.name(),
            UserPlanStatusEnum.EXPIRED.name(),
            UserPlanStatusEnum.PAYMENT_FAILED.name());

    // ─────────────────────────────────────────────────────────────────────────
    // Read: what can this learner switch to?
    // ─────────────────────────────────────────────────────────────────────────

    public PlanChangeOptionsDTO getChangeOptions(UserPlan userPlan, String instituteId) {
        PaymentPlan current = userPlan.getPaymentPlan();
        PlanChangeOptionsDTO.PlanChangeOptionsDTOBuilder builder = PlanChangeOptionsDTO.builder()
                .userPlanId(userPlan.getId())
                .currentPlanId(userPlan.getPaymentPlanId())
                .currentPlanName(current != null ? current.getName() : null)
                .currentPlanPrice(current != null ? current.getActualPrice() : null)
                .currentPaymentOptionId(userPlan.getPaymentOptionId())
                .currentOptionName(userPlan.getPaymentOption() != null ? userPlan.getPaymentOption().getName() : null)
                .currency(current != null ? current.getCurrency() : null)
                .currentValidityInDays(current != null ? current.getValidityInDays() : null)
                .currentEndDate(userPlan.getEndDate())
                .scheduledChange(toScheduledDto(openRequest(userPlan.getId())));

        // The institute-level master switch. Checked before anything else so an institute
        // that has not opted in behaves exactly as it did before this feature existed —
        // whatever the per-option and per-plan flags happen to say.
        if (!isEnabledForInstitute(instituteId)) {
            return builder.targets(List.of()).canChangePlan(false)
                    .blockedReason("PLAN_CHANGE_DISABLED_FOR_INSTITUTE").build();
        }

        String blocked = blockedReason(userPlan);
        if (blocked != null) {
            return builder.targets(List.of()).canChangePlan(false).blockedReason(blocked).build();
        }

        List<PlanChangeTargetDTO> targets = targetResolver.resolve(userPlan, instituteId).stream()
                .map(c -> toTargetDto(userPlan, c))
                .toList();

        return builder
                .targets(targets)
                .canChangePlan(!targets.isEmpty())
                .blockedReason(targets.isEmpty() ? "NO_ELIGIBLE_PLANS" : null)
                .build();
    }

    /**
     * Why this plan can't be changed at all, or null when it can. Distinguished from
     * "no eligible targets" so the UI can say something useful instead of showing an
     * empty picker.
     */
    private String blockedReason(UserPlan userPlan) {
        if (!CHANGEABLE_STATUSES.contains(userPlan.getStatus())) {
            return "PLAN_NOT_ACTIVE";
        }
        // One change in flight at a time -- two pending upgrades could both clear and the
        // second would apply on top of a plan the first already moved. But a checkout the
        // learner simply closed is not "in flight": nothing clears it, so it blocked plan
        // change on that membership for good. An unpaid one is superseded on the next
        // request instead (see supersedeIfAbandoned).
        UserPlanChangeRequest open = openRequest(userPlan.getId());
        if (open != null && !isAbandonedCheckout(open)) {
            return "CHANGE_ALREADY_IN_PROGRESS";
        }
        return null;
    }

    /**
     * A PENDING_PAYMENT request whose payment never landed. Deliberately narrow: a
     * SCHEDULED downgrade is a real booking, and a request whose log reads PAID is waiting
     * on a webhook, not abandoned -- cancelling either would lose something the learner has.
     */
    private boolean isAbandonedCheckout(UserPlanChangeRequest request) {
        if (!PlanChangeStatus.PENDING_PAYMENT.name().equals(request.getStatus())) {
            return false;
        }
        if (!StringUtils.hasText(request.getPaymentLogId())) {
            return true;
        }
        return paymentLogRepository.findById(request.getPaymentLogId())
                .map(log -> !PaymentStatusEnum.PAID.name().equalsIgnoreCase(log.getPaymentStatus()))
                .orElse(true);
    }

    /** Drops an abandoned checkout so the learner can start a new one. */
    private void supersedeIfAbandoned(UserPlan userPlan) {
        UserPlanChangeRequest open = openRequest(userPlan.getId());
        if (open != null && isAbandonedCheckout(open)) {
            open.setStatus(PlanChangeStatus.CANCELLED.name());
            changeRequestRepository.save(open);
            log.info("Plan change {} CANCELLED (abandoned checkout superseded by a new request) "
                    + "for user plan {}", open.getId(), userPlan.getId());
        }
    }

    /**
     * The institute-level master switch (PAYMENT_SETTING.planChangeEnabled).
     *
     * <p>Gates every LEARNER-facing path: the membership card's entry point, the options
     * listing and the change request itself. The admin override is deliberately NOT gated —
     * it is a back-office correction tool, already constrained by the per-option and
     * per-plan flags.
     */
    private boolean isEnabledForInstitute(String instituteId) {
        return paymentSettingService.isPlanChangeEnabled(instituteId);
    }

    private UserPlanChangeRequest openRequest(String userPlanId) {
        return changeRequestRepository
                .findFirstByUserPlanIdAndStatusInOrderByCreatedAtDesc(userPlanId, PlanChangeStatus.openStatuses())
                .orElse(null);
    }

    /**
     * What the membership card needs to know about plan change, in one pass.
     *
     * <p>Deliberately one call rather than a {@code canChangePlan} plus a
     * {@code getScheduledChange}: this runs per subscription on the learner's dashboard, and
     * the two answers share an open-request lookup. It also short-circuits — a plan with a
     * change already booked can't start another, so the expensive target resolution (a
     * mappings query, a bridge query and a lazy plan load per option) is skipped entirely.
     */
    public record PlanChangeSummary(boolean canChangePlan, ScheduledPlanChangeDTO scheduledChange) {
        static final PlanChangeSummary NONE = new PlanChangeSummary(false, null);
    }

    /**
     * @param packageSessionIds the learner's ACTIVE package sessions if the caller already
     *                          has them (the subscription listing does), else null to look
     *                          them up
     */
    public PlanChangeSummary summarise(UserPlan userPlan, String instituteId,
            List<String> packageSessionIds) {
        if (!isEnabledForInstitute(instituteId)) {
            return PlanChangeSummary.NONE;
        }
        UserPlanChangeRequest open = openRequest(userPlan.getId());
        // An abandoned checkout is reported but does not stop a fresh attempt -- the same
        // rule blockedReason applies. This method is the one the membership card reads, and
        // having its own copy of the rule is exactly why the card kept hiding "Change plan"
        // after the endpoint had already been fixed.
        ScheduledPlanChangeDTO openDto = toScheduledDto(open);
        if (open != null && !isAbandonedCheckout(open)) {
            return new PlanChangeSummary(false, openDto);
        }
        if (!CHANGEABLE_STATUSES.contains(userPlan.getStatus())) {
            // Still reported, so a learner on a dead plan can at least discard it.
            return new PlanChangeSummary(false, openDto);
        }
        List<PlanChangeTargetResolver.Candidate> targets = packageSessionIds != null
                ? targetResolver.resolve(userPlan, instituteId, packageSessionIds)
                : targetResolver.resolve(userPlan, instituteId);
        return new PlanChangeSummary(!targets.isEmpty(), openDto);
    }

    /**
     * The package sessions a plan change may be resolved against: the learner's ACTIVE
     * enrollments, or their INACTIVE ones when expiry has already deactivated them.
     */
    public List<String> packageSessionIdsForChange(String userPlanId) {
        return targetResolver.activePackageSessionIds(userPlanId);
    }

    public ScheduledPlanChangeDTO getScheduledChange(String userPlanId) {
        return toScheduledDto(openRequest(userPlanId));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Write: learner-initiated change
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Book a change for a learner. An upgrade returns a gateway checkout and applies on the
     * webhook; anything else is scheduled for the end of the cycle and applies at renewal.
     *
     * <p>Not {@code @Transactional} as a whole on purpose: the gateway call is a network
     * round trip and must not hold a database transaction open. The request row is
     * committed first (so a crash mid-checkout leaves a recoverable PENDING_PAYMENT row
     * rather than a charge with nothing to apply), then stamped with the order id.
     */
    public PlanChangeResponseDTO requestChange(UserPlan userPlan, String instituteId,
            PlanChangeRequestDTO request, CustomUserDetails userDetails) {

        if (!isEnabledForInstitute(instituteId)) {
            throw new VacademyException("Plan switching is not enabled for this institute");
        }
        String blocked = blockedReason(userPlan);
        if (blocked != null) {
            throw new VacademyException("Plan cannot be changed right now: " + blocked);
        }
        if (!StringUtils.hasText(request.getTargetPlanId())) {
            throw new VacademyException("targetPlanId is required");
        }

        PlanChangeTargetResolver.Candidate target =
                targetResolver.resolveOne(userPlan, instituteId, request.getTargetPlanId());
        if (target == null) {
            throw new VacademyException(
                    "Plan " + request.getTargetPlanId() + " is not available to switch to on this membership");
        }

        // blockedReason let this through because the previous checkout was never paid.
        // Close it now so only one request is ever open.
        supersedeIfAbandoned(userPlan);

        // Upgrades only for learners. resolveOne already filters these out, so reaching
        // here means a stale client or a hand-built request; refuse it rather than book a
        // scheduled downgrade nobody can see in the UI.
        if (target.direction() != PlanChangeDirection.UPGRADE) {
            throw new VacademyException("Only upgrades to a higher-priced plan are available");
        }

        UserPlanChangeRequest changeRequest = newRequest(userPlan, instituteId, target,
                "LEARNER", userDetails != null ? userDetails.getUserId() : userPlan.getUserId(), null);

        // A downgrade or a lateral move takes no money -- park it until the paid cycle ends.
        if (target.effectiveType() == PlanChangeEffectiveType.END_OF_CYCLE) {
            if (userPlan.getEndDate() == null) {
                // A lifetime plan has no cycle to wait for, so the change would sit
                // SCHEDULED forever and never fire. Refuse rather than book something
                // that silently does nothing.
                throw new VacademyException(
                        "This membership has no end date, so a downgrade cannot be scheduled");
            }
            changeRequest.setStatus(PlanChangeStatus.SCHEDULED.name());
            changeRequest.setScheduledFor(userPlan.getEndDate());
            changeRequestRepository.save(changeRequest);
            log.info("Plan change {} SCHEDULED for user plan {} → plan {} at {}",
                    changeRequest.getId(), userPlan.getId(), target.plan().getId(), userPlan.getEndDate());
            return toResponse(changeRequest, target, null);
        }

        // An upgrade fully covered by the proration credit costs nothing — there is no
        // order to create, so apply it straight away rather than opening an empty checkout.
        if (changeRequest.getChargeAmount() == null
                || changeRequest.getChargeAmount().compareTo(BigDecimal.ZERO) <= 0) {
            changeRequest.setStatus(PlanChangeStatus.PENDING_PAYMENT.name());
            changeRequestRepository.save(changeRequest);
            log.info("Plan change {} for user plan {} costs nothing after proration — applying immediately",
                    changeRequest.getId(), userPlan.getId());
            applyChange(changeRequest);
            return toResponse(changeRequest, target, null);
        }

        changeRequest.setStatus(PlanChangeStatus.PENDING_PAYMENT.name());
        changeRequestRepository.save(changeRequest);

        PaymentResponseDTO paymentResponse = initiateUpgradePayment(
                userPlan, instituteId, target, changeRequest, request.isWithAutopay(),
                request.getMandateMethod(), userDetails);
        return toResponse(changeRequest, target, paymentResponse);
    }

    /**
     * Opens the gateway checkout for an upgrade.
     *
     * <p>Vendor, gateway id and currency come from the TARGET's enroll invite, not the
     * learner's current one: a cross-option move can land on an invite with a different
     * gateway, and charging the old one would create an order the new plan's renewals can
     * never match.
     */
    private PaymentResponseDTO initiateUpgradePayment(UserPlan userPlan, String instituteId,
            PlanChangeTargetResolver.Candidate target, UserPlanChangeRequest changeRequest,
            boolean withAutopay, String mandateMethod, CustomUserDetails userDetails) {

        EnrollInvite invite = resolveInvite(target.enrollInviteId(), userPlan);
        if (invite == null) {
            throw new VacademyException("Target plan has no enrollment invite — cannot build payment");
        }

        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userPlan.getUserId()));
        if (users.isEmpty()) {
            throw new VacademyException("Learner account not found");
        }
        UserDTO user = users.get(0);

        PaymentInitiationRequestDTO paymentRequest = new PaymentInitiationRequestDTO();
        paymentRequest.setAmount(changeRequest.getChargeAmount().doubleValue());
        paymentRequest.setCurrency(StringUtils.hasText(changeRequest.getCurrency())
                ? changeRequest.getCurrency()
                : (StringUtils.hasText(invite.getCurrency()) ? invite.getCurrency() : "INR"));
        paymentRequest.setDescription("Plan change — " + target.plan().getName());
        paymentRequest.setInstituteId(instituteId);
        paymentRequest.setEmail(user.getEmail());
        paymentRequest.setVendor(invite.getVendor());
        paymentRequest.setVendorId(invite.getVendorId());
        // Propagates into Razorpay notes / Stripe metadata automatically, which is how the
        // webhook knows to route back here instead of into the initial-payment path.
        paymentRequest.setPaymentType(PaymentType.PLAN_CHANGE);

        RazorpayRequestDTO razorpayRequest = new RazorpayRequestDTO();
        razorpayRequest.setContact(user.getMobileNumber());
        razorpayRequest.setEmail(user.getEmail());
        paymentRequest.setRazorpayRequest(razorpayRequest);
        if (withAutopay) {
            // Same fill-in as enrolment: ceiling = the TARGET plan's price (what every
            // renewal will debit from now on), frequency as_presented, and the learner's
            // chosen / existing authorisation method instead of the gateway's card fallback.
            mandateRequestDefaults.applyMaxAmountAndFrequency(paymentRequest, invite, target.plan());
            mandateRequestDefaults.applyMethod(paymentRequest, mandateMethod,
                    userPlan.getUserId(), instituteId, invite.getVendor());
        }

        PaymentResponseDTO response = withAutopay
                // Mandate mode: one approval pays the difference AND re-registers auto-pay,
                // which is mandatory when the new price exceeds the old mandate's ceiling or
                // the target sits on a different gateway.
                ? paymentService.handleMandatePayment(user, instituteId, invite, userPlan, paymentRequest)
                : paymentService.handleUserPlanPayment(paymentRequest, instituteId, userDetails, userPlan.getId());

        // handleUserPlanPayment rewrites orderId to the PaymentLog id it created; that id is
        // the only handle the gateway gives back, so it is how the webhook finds this row.
        changeRequest.setPaymentLogId(paymentRequest.getOrderId());
        changeRequestRepository.save(changeRequest);
        log.info("Plan change {} PENDING_PAYMENT for user plan {} — order {} for {} {}",
                changeRequest.getId(), userPlan.getId(), paymentRequest.getOrderId(),
                paymentRequest.getCurrency(), paymentRequest.getAmount());
        return response;
    }

    /** Learner cancels a downgrade they booked but which has not landed yet. */
    @Transactional
    public void cancelScheduledChange(String userPlanId) {
        UserPlanChangeRequest open = openRequest(userPlanId);
        if (open == null) {
            throw new VacademyException("No plan change is scheduled for this membership");
        }
        // A scheduled booking can always be dropped, and so can a checkout that was never
        // paid. Only a request whose money has actually landed is refused -- that one is
        // waiting on a webhook and will apply by itself.
        if (!PlanChangeStatus.SCHEDULED.name().equals(open.getStatus()) && !isAbandonedCheckout(open)) {
            throw new VacademyException("A payment for this plan change is already in progress");
        }
        open.setStatus(PlanChangeStatus.CANCELLED.name());
        changeRequestRepository.save(open);
        log.info("Plan change {} CANCELLED for user plan {}", open.getId(), userPlanId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Write: admin override
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Admin moves a learner onto another plan with no payment — comps, corrections,
     * negotiated moves.
     *
     * <p>The access window is deliberately left alone: no money changed hands, so extending
     * (or truncating) what the learner already paid for would be arbitrary. The new price
     * takes effect at the next renewal.
     */
    @Transactional
    public UserPlan adminApplyChange(UserPlan userPlan, String instituteId,
            PlanChangeRequestDTO request, CustomUserDetails adminDetails) {

        if (!StringUtils.hasText(request.getTargetPlanId())) {
            throw new VacademyException("targetPlanId is required");
        }
        PlanChangeTargetResolver.Candidate target =
                targetResolver.resolveOne(userPlan, instituteId, request.getTargetPlanId());
        if (target == null) {
            throw new VacademyException(
                    "Plan " + request.getTargetPlanId() + " is not available to switch to on this membership");
        }

        UserPlanChangeRequest changeRequest = newRequest(userPlan, instituteId, target,
                "ADMIN", adminDetails != null ? adminDetails.getUserId() : null, request.getReason());
        // No charge on an admin override, whatever the proration says the difference is.
        changeRequest.setChargeAmount(BigDecimal.ZERO);
        changeRequest.setEffectiveType(PlanChangeEffectiveType.IMMEDIATE.name());
        changeRequest.setStatus(PlanChangeStatus.PENDING_PAYMENT.name());
        changeRequestRepository.save(changeRequest);

        return applyChange(changeRequest, /* preserveEndDate */ true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Write: apply — the single writer
    // ─────────────────────────────────────────────────────────────────────────

    @Transactional
    public UserPlan applyChange(UserPlanChangeRequest changeRequest) {
        return applyChange(changeRequest, /* preserveEndDate */ false);
    }

    /**
     * Moves the UserPlan onto the target plan. The one place that mutates plan/option/invite
     * for every route into this feature.
     *
     * @param preserveEndDate keep the current access window instead of restarting it. True
     *                        for an admin override (nothing was paid) and for a scheduled
     *                        downgrade (the renewal that triggered it sets the new window
     *                        itself, from the new plan's validity).
     */
    @Transactional
    public UserPlan applyChange(UserPlanChangeRequest changeRequest, boolean preserveEndDate) {
        UserPlan userPlan = userPlanRepository.findById(changeRequest.getUserPlanId())
                .orElseThrow(() -> new VacademyException(
                        "User plan not found: " + changeRequest.getUserPlanId()));

        if (PlanChangeStatus.APPLIED.name().equals(changeRequest.getStatus())) {
            log.info("Plan change {} already applied — skipping", changeRequest.getId());
            return userPlan;
        }

        PaymentPlan target = targetPlan(changeRequest);

        userPlan.setPaymentPlanId(changeRequest.getToPlanId());
        userPlan.setPlanJson(changeRequest.getToPlanJson());
        // plan_id is the writable column; the `paymentPlan` association is read-only and
        // would otherwise keep serving the OLD plan to anything that reads it off this
        // in-memory object — including the renewal's own validity lookup, which runs
        // immediately after a scheduled downgrade is applied. Only a managed row is
        // attached; a snapshot-only fallback stays detached on purpose.
        paymentPlanService.findById(changeRequest.getToPlanId()).ifPresent(userPlan::setPaymentPlan);

        if (changeRequest.isCrossOption()) {
            // An option is reachable only through an invite, so a cross-option move
            // necessarily repoints both. Everything gateway- and policy-related
            // (vendor, currency, access days, autopay) hangs off the invite.
            userPlan.setPaymentOptionId(changeRequest.getToPaymentOptionId());
            userPlan.setPaymentOptionJson(optionSnapshot(target));
            if (StringUtils.hasText(changeRequest.getToEnrollInviteId())) {
                userPlan.setEnrollInviteId(changeRequest.getToEnrollInviteId());
            }
        }

        Date newEndDate = userPlan.getEndDate();
        if (!preserveEndDate) {
            // Extends the window the learner already holds rather than restarting it:
            // they paid the price difference, so they get the validity difference. The
            // start date is left alone -- the cycle they are in did not restart.
            Date computed = prorationCalculator.newEndDate(userPlan, target, new Date());
            if (computed != null) {
                userPlan.setEndDate(computed);
                newEndDate = computed;
            }
        }

        // The learner has just paid for this plan, so the membership is live again: a
        // change applied to an EXPIRED or PAYMENT_FAILED plan left the status untouched,
        // which meant class access came back (extendMappings revives the mappings) while
        // billing did not -- findDueForRenewal and getUpcomingAutopayCharges both require
        // status ACTIVE, so the fresh mandate would never have been charged and the
        // dashboard would still have read "Expired". The trial flag and the dunning
        // counters go with it: real money has been taken.
        userPlan.setStatus(UserPlanStatusEnum.ACTIVE.name());
        userPlan.setIsTrial(false);
        userPlan.setRenewalAttemptCount(0);
        userPlan.setLastRenewalAttemptAt(null);

        reapplyAutopay(userPlan, changeRequest, newEndDate);
        userPlanRepository.save(userPlan);

        extendMappings(userPlan, newEndDate);

        changeRequest.setStatus(PlanChangeStatus.APPLIED.name());
        changeRequest.setAppliedAt(new Date());
        changeRequestRepository.save(changeRequest);

        log.info("Plan change {} APPLIED: user plan {} → plan {} (crossOption={}, endDate={})",
                changeRequest.getId(), userPlan.getId(), changeRequest.getToPlanId(),
                changeRequest.isCrossOption(), userPlan.getEndDate());

        emitPlanChanged(userPlan, changeRequest, target);
        return userPlan;
    }

    /**
     * Re-derives auto-pay from the invite the plan now sits under.
     *
     * <p>Deliberately reads only {@code AUTOPAY_SETTING.ENABLED} and never re-applies
     * TRIAL_DAYS: a trial is a first-enrollment concession, and re-running it here would
     * hand a paying member a free window every time they changed plan.
     */
    private void reapplyAutopay(UserPlan userPlan, UserPlanChangeRequest changeRequest, Date endDate) {
        if (!changeRequest.isCrossOption()) {
            // Same invite, same autopay config — just keep the charge date aligned.
            if (Boolean.TRUE.equals(userPlan.getAutoRenewalEnabled())) {
                userPlan.setNextChargeAt(endDate);
            }
            return;
        }
        EnrollInvite invite = resolveInvite(changeRequest.getToEnrollInviteId(), userPlan);
        boolean autopayEnabled = invite != null && autopayEnabledOn(invite);
        userPlan.setAutoRenewalEnabled(autopayEnabled);
        userPlan.setNextChargeAt(autopayEnabled ? endDate : null);
        if (!autopayEnabled) {
            log.info("Plan change: user plan {} moved to invite {} which has autopay off — "
                    + "auto-renewal cleared, learner renews manually",
                    userPlan.getId(), changeRequest.getToEnrollInviteId());
        }
    }

    private boolean autopayEnabledOn(EnrollInvite invite) {
        if (!StringUtils.hasText(invite.getSettingJson())) {
            return false;
        }
        try {
            JsonNode node = new ObjectMapper().readTree(invite.getSettingJson());
            return node.path("setting").path("AUTOPAY_SETTING").path("ENABLED").asBoolean(false);
        } catch (Exception e) {
            log.warn("Could not read AUTOPAY_SETTING from invite {}: {}", invite.getId(), e.getMessage());
            return false;
        }
    }

    /**
     * Carries the new access window onto the learner's enrollment rows, and revives any that
     * a previous expiry deactivated. Mirrors what a successful renewal does — the mapping
     * holds no invite or option reference, so nothing else on it moves.
     */
    private void extendMappings(UserPlan userPlan, Date newEndDate) {
        if (newEndDate == null) {
            return;
        }
        List<StudentSessionInstituteGroupMapping> active = mappingRepository
                .findByUserPlanIdAndStatus(userPlan.getId(), LearnerSessionStatusEnum.ACTIVE.name());
        for (StudentSessionInstituteGroupMapping mapping : active) {
            mapping.setExpiryDate(newEndDate);
            mappingRepository.save(mapping);
        }
        List<StudentSessionInstituteGroupMapping> inactive = mappingRepository
                .findByUserPlanIdAndStatus(userPlan.getId(), LearnerSessionStatusEnum.INACTIVE.name());
        for (StudentSessionInstituteGroupMapping mapping : inactive) {
            mapping.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
            mapping.setExpiryDate(newEndDate);
            mappingRepository.save(mapping);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Webhook: an upgrade payment settled
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Entry point for every gateway's PLAN_CHANGE branch (Razorpay and Stripe webhooks, the
     * eWay poller). {@code orderId} is the PaymentLog id the checkout was created with.
     *
     * <p>Idempotency rides the same atomic claim the school-payment path uses: Razorpay
     * delivers both {@code payment.captured} and {@code order.paid}, and production runs
     * several replicas, so without it one upgrade could be applied — and ledgered — twice.
     */
    @Transactional
    public void handlePlanChangePaymentConfirmation(String orderId, String instituteId,
            PaymentStatusEnum paymentStatus) {

        UserPlanChangeRequest changeRequest = changeRequestRepository
                .findFirstByPaymentLogIdOrderByCreatedAtDesc(orderId).orElse(null);
        if (changeRequest == null) {
            log.warn("PLAN_CHANGE webhook for order {} has no change request — ignoring", orderId);
            return;
        }

        if (paymentStatus == PaymentStatusEnum.FAILED) {
            changeRequest.setStatus(PlanChangeStatus.FAILED.name());
            changeRequestRepository.save(changeRequest);
            // The user_plan was never touched, so the learner simply stays where they were.
            log.info("Plan change {} FAILED (order {}) — learner stays on plan {}",
                    changeRequest.getId(), orderId, changeRequest.getFromPlanId());
            return;
        }
        if (paymentStatus != PaymentStatusEnum.PAID) {
            log.info("PLAN_CHANGE webhook for order {} is {} — waiting for a terminal status",
                    orderId, paymentStatus);
            return;
        }

        int claimed = paymentLogService.claimPaidIfNotAlready(orderId);
        if (claimed == 0) {
            log.info("PLAN_CHANGE order {} already claimed by another event or replica — skipping duplicate",
                    orderId);
            return;
        }

        PaymentLog paymentLog = paymentLogRepository.findById(orderId).orElse(null);
        if (paymentLog != null) {
            paymentLog.setPaymentStatus(PaymentStatusEnum.PAID.name());
            paymentLog.setStatus(PaymentLogStatusEnum.SUCCESS.name());
            paymentLogRepository.save(paymentLog);
            recordOnLedger(paymentLog, changeRequest, instituteId);
        }

        applyChange(changeRequest);
        scheduleInvoicing(orderId, instituteId);
    }

    /**
     * Books the upgrade as a charge raised and settled in one step, same as a renewal.
     * Best-effort and replay-safe — {@code recordSettledCharge} dedupes on the PaymentLog,
     * and a ledger failure must never cost a member the plan they just paid for.
     */
    private void recordOnLedger(PaymentLog paymentLog, UserPlanChangeRequest changeRequest, String instituteId) {
        if (paymentLog.getPaymentAmount() == null || paymentLog.getPaymentAmount() <= 0
                || !StringUtils.hasText(instituteId)) {
            return;
        }
        try {
            userAccountLedgerService.recordSettledCharge(
                    paymentLog.getUserId(), instituteId,
                    BigDecimal.valueOf(paymentLog.getPaymentAmount()),
                    paymentLog.getCurrency() != null ? paymentLog.getCurrency() : "INR",
                    null,
                    "USER_PLAN", changeRequest.getUserPlanId(),
                    paymentLog.getId(), "Plan change");
        } catch (Exception e) {
            log.error("Plan change {} succeeded but ledger posting failed for payment log {}: {}",
                    changeRequest.getId(), paymentLog.getId(), e.getMessage(), e);
        }
    }

    /**
     * Invoicing runs after commit, never inside the change transaction: PDF generation and
     * the S3 upload open their own transaction, and a failure there would mark this one
     * rollback-only — silently undoing a plan change the learner has already paid for.
     */
    private void scheduleInvoicing(String orderId, String instituteId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    runInvoicing(orderId, instituteId);
                }
            });
        } else {
            runInvoicing(orderId, instituteId);
        }
    }

    private void runInvoicing(String orderId, String instituteId) {
        try {
            PaymentLog paymentLog = paymentLogRepository.findById(orderId).orElse(null);
            if (paymentLog == null || paymentLog.getUserPlan() == null
                    || paymentLog.getPaymentAmount() == null || paymentLog.getPaymentAmount() <= 0) {
                return;
            }
            // Idempotent by way of invoice generation's own existsByPaymentLogId guard, so a
            // retried webhook finds the invoice already there rather than mailing twice.
            invoiceService.generateInvoiceWithResult(paymentLog.getUserPlan(), paymentLog, instituteId, true);
        } catch (Exception e) {
            log.error("Plan change succeeded but invoicing failed for order {}: {}", orderId, e.getMessage(), e);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Renewal integration: scheduled downgrades
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The plan the next renewal should bill, honouring a scheduled downgrade. Returns null
     * when nothing is scheduled, so callers keep their existing behaviour.
     */
    public PaymentPlan pendingTargetPlan(UserPlan userPlan) {
        UserPlanChangeRequest open = openRequest(userPlan.getId());
        if (open == null || !PlanChangeStatus.SCHEDULED.name().equals(open.getStatus())) {
            return null;
        }
        return targetPlan(open);
    }

    /**
     * Applies a scheduled change at the moment its cycle ends. Called from the renewal path
     * BEFORE the new end date is computed, so the extension uses the new plan's validity.
     *
     * <p>{@code preserveEndDate} is true because the renewal is about to set the window
     * itself — restarting it here would double-count the cycle.
     */
    @Transactional
    public void applyScheduledChangeIfDue(UserPlan userPlan) {
        UserPlanChangeRequest open = openRequest(userPlan.getId());
        if (open == null || !PlanChangeStatus.SCHEDULED.name().equals(open.getStatus())) {
            return;
        }
        log.info("Applying scheduled plan change {} for user plan {} at renewal",
                open.getId(), userPlan.getId());
        UserPlan updated = applyChange(open, /* preserveEndDate */ true);
        if (updated == userPlan) {
            return; // same managed instance — already in step
        }
        // The caller holds its own reference; keep it in step so the end-date maths that
        // follows reads the plan the learner is now on rather than the one they left.
        userPlan.setPaymentPlanId(updated.getPaymentPlanId());
        userPlan.setPaymentPlan(updated.getPaymentPlan());
        userPlan.setPlanJson(updated.getPlanJson());
        userPlan.setPaymentOptionId(updated.getPaymentOptionId());
        userPlan.setEnrollInviteId(updated.getEnrollInviteId());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private UserPlanChangeRequest newRequest(UserPlan userPlan, String instituteId,
            PlanChangeTargetResolver.Candidate target, String requestedBy, String requestedByUserId,
            String reason) {

        UserPlanChangeRequest request = new UserPlanChangeRequest();
        request.setUserPlanId(userPlan.getId());
        request.setInstituteId(instituteId);
        request.setFromPlanId(userPlan.getPaymentPlanId());
        request.setToPlanId(target.plan().getId());
        request.setFromPlanJson(userPlan.getPlanJson());
        request.setToPlanJson(JsonUtil.toJson(target.plan().mapToPaymentPlanDTO()));
        request.setFromPaymentOptionId(userPlan.getPaymentOptionId());
        request.setToPaymentOptionId(target.option().getId());
        request.setFromEnrollInviteId(userPlan.getEnrollInviteId());
        request.setToEnrollInviteId(target.enrollInviteId());
        request.setDirection(target.direction().name());
        request.setEffectiveType(target.effectiveType().name());
        request.setProrationCredit(target.proration().credit());
        request.setChargeAmount(target.effectiveType() == PlanChangeEffectiveType.IMMEDIATE
                ? target.proration().amountDueNow()
                : BigDecimal.ZERO);
        request.setCurrency(target.plan().getCurrency());
        request.setRequestedBy(requestedBy);
        request.setRequestedByUserId(requestedByUserId);
        request.setReason(reason);
        return request;
    }

    /**
     * The plan a request points at. Falls back to the {@code to_plan_json} snapshot when the
     * live row has since been retired by a Payment Settings edit — the learner agreed to
     * what was on offer at request time, and that is what must be applied.
     */
    private PaymentPlan targetPlan(UserPlanChangeRequest changeRequest) {
        PaymentPlan live = paymentPlanService.findById(changeRequest.getToPlanId()).orElse(null);
        if (live != null) {
            return live;
        }
        PaymentPlan snapshot = new PaymentPlan();
        try {
            var dto = JsonUtil.fromJson(changeRequest.getToPlanJson(),
                    vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO.class);
            if (dto != null) {
                snapshot.setId(changeRequest.getToPlanId());
                snapshot.setName(dto.getName());
                snapshot.setValidityInDays(dto.getValidityInDays());
                snapshot.setActualPrice(dto.getActualPrice() != null ? dto.getActualPrice() : 0d);
                snapshot.setCurrency(dto.getCurrency());
                return snapshot;
            }
        } catch (Exception e) {
            log.warn("Could not read to_plan_json for change request {}: {}",
                    changeRequest.getId(), e.getMessage());
        }
        snapshot.setId(changeRequest.getToPlanId());
        return snapshot;
    }

    private String optionSnapshot(PaymentPlan target) {
        return target.getPaymentOption() != null
                ? JsonUtil.toJson(target.getPaymentOption().mapToPaymentOptionDTOWithoutPlans())
                : null;
    }

    private EnrollInvite resolveInvite(String enrollInviteId, UserPlan fallback) {
        if (StringUtils.hasText(enrollInviteId)) {
            EnrollInvite invite = enrollInviteRepository.findById(enrollInviteId).orElse(null);
            if (invite != null) {
                return invite;
            }
        }
        return fallback != null ? fallback.getEnrollInvite() : null;
    }

    /**
     * Fires once the change has actually landed — never on request — so messaging workflows
     * describe what is true. Best-effort, like every other emitter on the money path.
     */
    private void emitPlanChanged(UserPlan userPlan, UserPlanChangeRequest changeRequest, PaymentPlan target) {
        try {
            Map<String, Object> ctx = new HashMap<>();
            ctx.put("userPlanId", userPlan.getId());
            ctx.put("userId", userPlan.getUserId());
            ctx.put("enrollInviteId", userPlan.getEnrollInviteId());
            ctx.put("changeRequestId", changeRequest.getId());
            ctx.put("direction", changeRequest.getDirection());
            ctx.put("fromPlanId", changeRequest.getFromPlanId());
            ctx.put("toPlanId", changeRequest.getToPlanId());
            ctx.put("toPlanName", target != null ? target.getName() : null);
            ctx.put("amountCharged", changeRequest.getChargeAmount());
            ctx.put("requestedBy", changeRequest.getRequestedBy());
            ctx.put("endDate", userPlan.getEndDate() != null ? userPlan.getEndDate().toString() : null);
            try {
                List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userPlan.getUserId()));
                if (!users.isEmpty()) {
                    ctx.put("user", users.get(0));
                }
            } catch (Exception ue) {
                log.warn("Could not enrich plan-change event with user {}: {}",
                        userPlan.getUserId(), ue.getMessage());
            }
            String eventId = StringUtils.hasText(userPlan.getEnrollInviteId())
                    ? userPlan.getEnrollInviteId()
                    : changeRequest.getInstituteId();
            workflowTriggerService.handleTriggerEvents(
                    WorkflowTriggerEvent.SUBSCRIPTION_PLAN_CHANGED.name(),
                    eventId, changeRequest.getInstituteId(), ctx);
        } catch (Exception e) {
            log.warn("Failed to trigger SUBSCRIPTION_PLAN_CHANGED for plan {}: {}",
                    userPlan.getId(), e.getMessage());
        }
    }

    // ── DTO mapping ─────────────────────────────────────────────────────────

    private PlanChangeTargetDTO toTargetDto(UserPlan userPlan, PlanChangeTargetResolver.Candidate candidate) {
        PaymentPlan plan = candidate.plan();
        boolean immediate = candidate.effectiveType() == PlanChangeEffectiveType.IMMEDIATE;
        return PlanChangeTargetDTO.builder()
                .planId(plan.getId())
                .planName(plan.getName())
                .paymentOptionId(candidate.option().getId())
                .optionName(candidate.option().getName())
                .optionType(candidate.option().getType())
                .enrollInviteId(candidate.enrollInviteId())
                .price(plan.getActualPrice())
                .currency(plan.getCurrency())
                .validityInDays(plan.getValidityInDays())
                .featureJson(plan.getFeatureJson())
                .description(plan.getDescription())
                .direction(candidate.direction().name())
                .effectiveType(candidate.effectiveType().name())
                .prorationCredit(candidate.proration().credit().doubleValue())
                .tradeInApplied(candidate.proration().credit().signum() > 0)
                .extensionDays(candidate.proration().extensionDays())
                .amountDueNow(immediate ? candidate.proration().amountDueNow().doubleValue() : 0d)
                .effectiveFrom(immediate ? new Date() : userPlan.getEndDate())
                .requiresMandateReauth(candidate.requiresMandateReauth())
                .crossOption(candidate.crossOption())
                .build();
    }

    private ScheduledPlanChangeDTO toScheduledDto(UserPlanChangeRequest request) {
        // Both open states are reported. Returning null for PENDING_PAYMENT made an
        // abandoned checkout invisible while it still blocked a second attempt: no button,
        // no notice, no way for the learner to finish or drop it.
        if (request == null || !PlanChangeStatus.openStatuses().contains(request.getStatus())) {
            return null;
        }
        boolean awaitingPayment = PlanChangeStatus.PENDING_PAYMENT.name().equals(request.getStatus());
        PaymentPlan target = targetPlan(request);
        return ScheduledPlanChangeDTO.builder()
                .changeRequestId(request.getId())
                .toPlanId(request.getToPlanId())
                .toPlanName(target != null ? target.getName() : null)
                .toPlanPrice(target != null ? target.getActualPrice() : null)
                .currency(request.getCurrency())
                .effectiveFrom(request.getScheduledFor())
                .status(request.getStatus())
                .amountDueNow(awaitingPayment && request.getChargeAmount() != null
                        ? request.getChargeAmount().doubleValue()
                        : null)
                .build();
    }

    private PlanChangeResponseDTO toResponse(UserPlanChangeRequest request,
            PlanChangeTargetResolver.Candidate target, PaymentResponseDTO paymentResponse) {
        return PlanChangeResponseDTO.builder()
                .status(request.getStatus())
                .changeRequestId(request.getId())
                .direction(request.getDirection())
                .toPlanId(request.getToPlanId())
                .toPlanName(target.plan().getName())
                .effectiveFrom(request.getScheduledFor() != null ? request.getScheduledFor() : request.getAppliedAt())
                .amountDueNow(request.getChargeAmount() != null ? request.getChargeAmount().doubleValue() : 0d)
                .prorationCredit(request.getProrationCredit() != null
                        ? request.getProrationCredit().doubleValue()
                        : 0d)
                .currency(request.getCurrency())
                .requiresMandateReauth(target.requiresMandateReauth())
                .paymentResponse(paymentResponse)
                .build();
    }
}
