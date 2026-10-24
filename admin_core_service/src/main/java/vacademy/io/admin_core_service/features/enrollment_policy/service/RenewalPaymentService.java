package vacademy.io.admin_core_service.features.enrollment_policy.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.regional_pricing.service.RegionalPriceLock;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.enroll_invite.service.SubOrgService;
import vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanSourceEnum;
import vacademy.io.admin_core_service.features.user_subscription.util.PlanValidityResolver;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
@Slf4j
public class RenewalPaymentService {

    private final UserPlanRepository userPlanRepository;
    private final StudentSessionInstituteGroupMappingRepository mappingRepository;
    private final SubOrgService subOrgService;
    private final PaymentLogRepository paymentLogRepository;
    private final vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogLineItemRepository paymentLogLineItemRepository;
    private final WorkflowTriggerService workflowTriggerService;
    private final AuthService authService;
    private final vacademy.io.admin_core_service.features.user_subscription.service.UserInstitutePaymentGatewayMappingService mandateService;
    private final vacademy.io.admin_core_service.features.invoice.service.InvoiceService invoiceService;
    private final vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService paymentNotificatonService;
    private final vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService userAccountLedgerService;
    private final vacademy.io.admin_core_service.features.plan_change.service.PlanChangeService planChangeService;
    private final RenewalGracePolicy gracePolicy;
    private final vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService paymentLogService;

    /**
     * Lazy because UserPlanService reaches back into this service's neighbourhood (renewal,
     * plan change, enrolment all call one another) and eager injection closes a bean cycle at
     * startup. Only used by the enrolment safety net in handleSuccessfulRenewal.
     */
    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService userPlanService;

    /** Same dunning ceiling as RenewalChargeService (policy override not yet snapshotted). */
    private static final int MAX_RENEWAL_ATTEMPTS = 3;

    /**
     * Handles renewal payment confirmation from webhook
     */
    @Transactional
    public void handleRenewalPaymentConfirmation(String orderId, String instituteId, 
                                                  PaymentStatusEnum paymentStatus, Object paymentDetails) {
        log.info("Handling renewal payment confirmation: orderId={}, status={}", orderId, paymentStatus);

        // Find UserPlan by orderId (assuming orderId maps to UserPlan)
        // You may need to adjust this based on how orderId relates to UserPlan
        PaymentLog paymentLog = paymentLogRepository.findById(orderId).orElseThrow(()->new VacademyException("Payment Log not found with id "+orderId));
        if (paymentLog == null) {
            log.warn("No UserPlan found for orderId: {}", orderId);
            return;
        }
        UserPlan userPlan = paymentLog.getUserPlan();
        if (paymentStatus == PaymentStatusEnum.PAID) {
            // Razorpay delivers payment.captured AND order.paid for one capture, and prod
            // runs 4 replicas, so this arrives more than once. Without a claim every
            // delivery extended the plan by a full cycle: one Rs 1,200 payment bought two
            // months, one Rs 7,200 payment two years (2026-09-19). The conditional UPDATE
            // flips the log to PAID exactly once, in its own transaction, so only the
            // winning delivery runs the ledger / extension / invoice side effects.
            if (paymentLogService.claimPaidIfNotAlready(orderId) == 0) {
                log.info("RENEWAL order {} already applied by another event or replica — skipping duplicate", orderId);
                return;
            }
            paymentLog.setPaymentStatus(PaymentStatusEnum.PAID.name());
            paymentLog.setStatus(PaymentLogStatusEnum.SUCCESS.name());
            recordRenewalOnLedger(paymentLog, userPlan, instituteId);
            countDiscountedCycle(paymentLog, userPlan);
            handleSuccessfulRenewal(userPlan, instituteId);
            scheduleRenewalInvoicing(orderId, instituteId);
        } else if (paymentStatus == PaymentStatusEnum.FAILED) {
            // Record the failure on the log itself, mirroring the PAID branch above.
            // Without this the row keeps the PAYMENT_PENDING it was created with, so a
            // declined renewal is indistinguishable from one still awaiting its webhook:
            // it stays "pending" forever, inflates the pending figures in reporting, and
            // gives nobody a signal that the member's autopay is failing. Every gateway
            // funnels through here (Razorpay + Stripe webhooks, the eWay poller), so this
            // was silently true of every failed renewal on every gateway.
            // Monotonic: never regress a log that already settled. Razorpay can deliver
            // payment.failed for an earlier attempt on an order whose later attempt was
            // captured, and with 4 replicas the two are handled concurrently.
            int marked = paymentLogRepository.updatePaymentStatusIfNotPaid(
                    paymentLog.getId(), PaymentStatusEnum.FAILED.name(), PaymentStatusEnum.PAID.name());
            if (marked == 0) {
                log.info("RENEWAL order {} is already PAID — ignoring a late failure event", orderId);
                return;
            }
            paymentLog.setPaymentStatus(PaymentStatusEnum.FAILED.name());
            paymentLog.setStatus(PaymentLogStatusEnum.FAILED.name());
            paymentLogRepository.save(paymentLog);
            handleFailedRenewal(userPlan, instituteId);
        } else {
            log.info("Payment status is PENDING for orderId: {}, waiting for final status", orderId);
        }
    }

    /**
     * A renewal that carried the plan's discount line uses up one of the discount's
     * billing cycles (admin discounts may be limited to the first N charges). Counted
     * here, after the exactly-once PAID claim, so a failed or replayed charge never
     * spends a cycle.
     */
    private void countDiscountedCycle(PaymentLog paymentLog, UserPlan userPlan) {
        if (userPlan == null || userPlan.getAppliedCouponDiscountId() == null) {
            return;
        }
        if (paymentLogLineItemRepository.existsByPaymentLogIdAndSourceId(
                paymentLog.getId(), userPlan.getAppliedCouponDiscountId())) {
            int used = userPlan.getDiscountCyclesApplied() != null ? userPlan.getDiscountCyclesApplied() : 0;
            userPlan.setDiscountCyclesApplied(used + 1);
            userPlanRepository.save(userPlan);
        }
    }

    /**
     * Books the renewal on the learner's account ledger as a charge raised and settled in
     * one step.
     *
     * <p>Renewals were absent from the ledger entirely. Nothing was accrued (a renewal
     * reuses the same UserPlan, so {@code createUserPlan}'s accrual never fires again) and
     * nothing was credited, so the balance stayed right by accident while every renewal was
     * invisible in the side-view Transaction History and the learner's lifetime billing was
     * understated by the whole renewal history. Crediting alone would have been worse — Total
     * Paid would climb against an accrual that was never raised.
     *
     * <p>Hooked into {@link #handleRenewalPaymentConfirmation} rather than at the call sites
     * for the same reason invoicing is: every gateway funnels through it — Razorpay and
     * Stripe webhooks, the eWay poller, and RenewalChargeService's sync autopay charge.
     *
     * <p>Best-effort and replay-safe: {@code recordSettledCharge} is idempotent on the
     * PaymentLog, and a ledger failure must never cost the member their renewed access.
     */
    private void recordRenewalOnLedger(PaymentLog paymentLog, UserPlan userPlan, String instituteId) {
        if (userPlan == null
                || paymentLog.getPaymentAmount() == null
                || paymentLog.getPaymentAmount() <= 0
                || instituteId == null || instituteId.isBlank()) {
            return;
        }
        try {
            userAccountLedgerService.recordSettledCharge(
                    paymentLog.getUserId(), instituteId,
                    java.math.BigDecimal.valueOf(paymentLog.getPaymentAmount()),
                    paymentLog.getCurrency() != null ? paymentLog.getCurrency() : "INR",
                    null,
                    "USER_PLAN", userPlan.getId(),
                    paymentLog.getId(), "Subscription renewal");
        } catch (Exception e) {
            log.error("Renewal succeeded but ledger posting failed for paymentLog {} (userPlan {}): {}",
                    paymentLog.getId(), userPlan.getId(), e.getMessage(), e);
        }
    }

    /**
     * Queue the renewal's invoice + receipt to run once this transaction commits.
     *
     * <p>Invoicing must not share the renewal transaction: {@code generateInvoiceWithResult}
     * is itself {@code @Transactional}, so a PDF/S3 failure inside would mark the
     * transaction rollback-only and silently undo the plan extension — leaving a member
     * who has already been charged without access. Deferring to after-commit means the
     * worst case is a renewal with a missing invoice, which is logged and re-issuable.</p>
     *
     * <p>Hooked here rather than at the call sites because every gateway funnels through
     * {@link #handleRenewalPaymentConfirmation} — Razorpay and Stripe webhooks, the eWay
     * poller, and the sync charge path in RenewalChargeService. Any future gateway gets
     * invoicing for free instead of having to remember it.</p>
     */
    private void scheduleRenewalInvoicing(String orderId, String instituteId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    runRenewalInvoicing(orderId, instituteId);
                }
            });
        } else {
            runRenewalInvoicing(orderId, instituteId);
        }
    }

    /** Best-effort wrapper: the money is already taken, so invoicing can never break the renewal. */
    private void runRenewalInvoicing(String orderId, String instituteId) {
        try {
            generateRenewalInvoiceAndNotify(orderId, instituteId);
        } catch (Exception e) {
            log.error("Renewal succeeded but invoicing failed for orderId {}: {}", orderId, e.getMessage(), e);
        }
    }

    /**
     * Invoice + receipt email for a renewal payment, mirroring what the enrollment
     * path does in {@code PaymentLogService.handlePostPaymentLogic}: generate a real
     * Invoice (so the payment-history tab has a downloadable INV- document) and mail
     * it, honouring the institute's {@code INVOICE_SETTING.invoicePdfPlacement} — a
     * separate invoice email, or one confirmation email carrying the PDF.
     *
     * <p>Runs with no transaction of its own — {@link #scheduleRenewalInvoicing} calls it
     * after the renewal has committed, and {@code generateInvoiceWithResult} opens its
     * own transaction. Also safe to call directly to re-issue an invoice for a renewal
     * whose first attempt failed.</p>
     *
     * <p>Idempotency piggybacks on invoice generation's own {@code existsByPaymentLogId}
     * guard, exactly as the enrollment path does: a retried webhook finds the invoice
     * already there and skips the email rather than mailing the member twice.</p>
     */
    public void generateRenewalInvoiceAndNotify(String orderId, String instituteId) {
        PaymentLog paymentLog = paymentLogRepository.findById(orderId).orElse(null);
        if (paymentLog == null || paymentLog.getUserPlan() == null) {
            log.warn("Renewal invoice skipped — no payment log / user plan for orderId {}", orderId);
            return;
        }
        if (paymentLog.getPaymentAmount() == null || paymentLog.getPaymentAmount() <= 0) {
            log.info("Renewal invoice skipped — non-positive amount on payment log {}", paymentLog.getId());
            return;
        }

        var pdfPlacement = invoiceService.getInvoicePdfPlacement(instituteId);
        boolean attachInvoiceToConfirmation =
                pdfPlacement == vacademy.io.admin_core_service.features.invoice.enums.InvoicePdfPlacement.PAYMENT_CONFIRMATION_EMAIL;

        log.info("Generating renewal invoice for payment log {} (pdfPlacement={})",
                paymentLog.getId(), pdfPlacement);
        var invoiceResult = invoiceService.generateInvoiceWithResult(
                paymentLog.getUserPlan(),
                paymentLog,
                instituteId,
                /* sendEmail */ !attachInvoiceToConfirmation);

        if (attachInvoiceToConfirmation && invoiceResult != null && !invoiceResult.isAlreadyExisted()) {
            String invoiceNumber = invoiceResult.getInvoice() != null
                    ? invoiceResult.getInvoice().getInvoiceNumber()
                    : null;
            sendRenewalConfirmationEmail(paymentLog, instituteId, invoiceResult.getPdfBytes(), invoiceNumber);
        }
        log.info("Renewal invoice complete for payment log {}", paymentLog.getId());
    }

    /**
     * Consolidated renewal receipt: the payment-confirmation email with the invoice
     * PDF attached. Mirrors {@code PaymentLogService.sendSyncPaymentConfirmation} —
     * the renewal webhook carries no gateway DTOs, so we build a minimal
     * response/request pair from the PaymentLog itself. Best-effort: a mail failure
     * is logged and never disturbs the completed renewal.
     */
    private void sendRenewalConfirmationEmail(PaymentLog paymentLog, String instituteId,
            byte[] pdfBytes, String invoiceNumber) {
        try {
            if (paymentLog.getUserId() == null) {
                return;
            }
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(paymentLog.getUserId()));
            if (users == null || users.isEmpty() || users.get(0) == null) {
                log.warn("Renewal confirmation email skipped — user {} not found", paymentLog.getUserId());
                return;
            }
            UserDTO userDTO = users.get(0);

            var responseDTO = new vacademy.io.common.payment.dto.PaymentResponseDTO();
            Map<String, Object> responseData = new HashMap<>();
            responseData.put("paymentStatus", PaymentStatusEnum.PAID.name());
            responseData.put("amount", paymentLog.getPaymentAmount());
            responseData.put("transactionId", paymentLog.getId());
            responseDTO.setResponseData(responseData);

            var requestDTO = new vacademy.io.common.payment.dto.PaymentInitiationRequestDTO();
            requestDTO.setCurrency(paymentLog.getCurrency());
            requestDTO.setEmail(userDTO.getEmail());

            paymentNotificatonService.sendPaymentConfirmationNotification(
                    instituteId, responseDTO, requestDTO, userDTO, pdfBytes, invoiceNumber);
        } catch (Exception e) {
            log.error("Failed to send renewal confirmation email for payment log {}: {}",
                    paymentLog.getId(), e.getMessage(), e);
        }
    }

    /**
     * Handles successful renewal payment
     */
    private void handleSuccessfulRenewal(UserPlan userPlan, String instituteId) {
        log.info("Processing successful renewal for UserPlan: {}", userPlan.getId());

        try {
            // A downgrade booked for the end of this cycle lands here, BEFORE the new end
            // date is worked out — so the extension uses the new plan's validity, not the
            // one the learner is leaving.
            try {
                planChangeService.applyScheduledChangeIfDue(userPlan);
            } catch (Exception pce) {
                log.error("Scheduled plan change could not be applied for plan {} — renewing on the "
                        + "existing plan instead: {}", userPlan.getId(), pce.getMessage(), pce);
            }

            // Extend UserPlan endDate based on subscription period
            Date newEndDate = calculateNewEndDate(userPlan);
            userPlan.setEndDate(newEndDate);
            // Successful renewal clears the trial flag and dunning counters. A
            // manual renewal payment (learner paid via the subscriptions page after
            // cancelling autopay or after dunning expired the plan) REACTIVATES the
            // existing membership: same plan row, back to ACTIVE.
            userPlan.setStatus(UserPlanStatusEnum.ACTIVE.name());
            userPlan.setIsTrial(false);
            userPlan.setRenewalAttemptCount(0);
            userPlan.setLastRenewalAttemptAt(null);
            // Re-arm the auto-charge only when autopay is on. A learner who revoked
            // their mandate stays in manual mode (next_charge_at null) — the
            // pre-expiry workflow sends them the payment link each cycle instead of
            // the sweep attempting a charge against a dead mandate. If the renewal
            // checkout ALSO registered a fresh mandate ("enable auto-pay" option),
            // resume autopay: a live mandate for this plan flips the flag back on.
            //
            // getMandate, NOT getMandateOrLegacyToken: the legacy fallback SYNTHESISES an
            // ACTIVE mandate from any saved card-on-file token (eWay), so asking it here read
            // "this learner has a card" as "this learner authorised recurring billing" and
            // silently switched autopay back on for anyone paying a single renewal by card.
            // A stored card is not consent to be charged again — only an explicitly
            // registered mandate is, and that is exactly what getMandate reports.
            boolean autopayOn = Boolean.TRUE.equals(userPlan.getAutoRenewalEnabled());
            if (!autopayOn) {
                try {
                    String vendor = userPlan.getEnrollInvite() != null ? userPlan.getEnrollInvite().getVendor() : null;
                    var mandate = vendor != null ? mandateService.getMandate(
                            userPlan.getUserId(), instituteId, vendor, userPlan.getId()) : null;
                    if (mandate != null && vacademy.io.admin_core_service.features.user_subscription.dto.MandateInfo.STATUS_ACTIVE
                            .equalsIgnoreCase(mandate.getStatus())) {
                        userPlan.setAutoRenewalEnabled(true);
                        autopayOn = true;
                        log.info("Plan {}: fresh ACTIVE mandate found on renewal — autopay resumed", userPlan.getId());
                    }
                } catch (Exception me) {
                    log.warn("Plan {}: could not check mandate for autopay resume: {}", userPlan.getId(), me.getMessage());
                }
            }
            userPlan.setNextChargeAt(autopayOn ? newEndDate : null);
            userPlanRepository.save(userPlan);

            log.info("Extended UserPlan {} endDate to: {} (autopay={}, status=ACTIVE)",
                    userPlan.getId(), newEndDate, autopayOn);

            // Extend ACTIVE mappings and REACTIVATE INACTIVE ones (deactivated by
            // dunning exhaustion or post-expiry cleanup) — same rows, no new records.
            List<StudentSessionInstituteGroupMapping> activeMappings =
                mappingRepository.findByUserPlanIdAndStatus(userPlan.getId(), LearnerSessionStatusEnum.ACTIVE.name());

            for (StudentSessionInstituteGroupMapping mapping : activeMappings) {
                mapping.setExpiryDate(newEndDate);
                mappingRepository.save(mapping);
                log.info("Extended mapping {} expiryDate to: {}", mapping.getId(), newEndDate);
            }

            List<StudentSessionInstituteGroupMapping> inactiveMappings =
                mappingRepository.findByUserPlanIdAndStatus(userPlan.getId(), LearnerSessionStatusEnum.INACTIVE.name());
            for (StudentSessionInstituteGroupMapping mapping : inactiveMappings) {
                mapping.setStatus(LearnerSessionStatusEnum.ACTIVE.name());
                mapping.setExpiryDate(newEndDate);
                mappingRepository.save(mapping);
                log.info("REACTIVATED mapping {} (expiry {})", mapping.getId(), newEndDate);
            }

            // Nothing to extend and nothing to reactivate means this plan holds no access at
            // all, yet money just landed on it. Extending zero rows used to "succeed" in
            // silence: the plan read ACTIVE until 2027 while the learner sat in no batch, got
            // no class links and appeared in no member list (Nitika Maheshwari, 2026-10-04,
            // Rs 7,200). Enrol instead. ensureEnrollmentExists is idempotent, never throws,
            // and runs the same INVITED -> ACTIVE shift the first-payment path runs, which
            // also fires the enrollment workflow — so the learner gets the member message and
            // the next class batch picks them up without anyone intervening by hand.
            if (activeMappings.isEmpty() && inactiveMappings.isEmpty()) {
                log.warn("Renewal paid on plan {} which holds no mapping at all — enrolling the "
                        + "learner now instead of extending nothing", userPlan.getId());
                userPlanService.ensureEnrollmentExists(userPlan);
            }

            // Send success notification
            sendRenewalSuccessNotification(userPlan, instituteId, newEndDate);

            // Fire PAYMENT_SUCCESS so workflows (renewal-confirmation WhatsApp/email) can react.
            // Renewals previously emitted NO workflow events at all.
            Map<String, Object> extra = new HashMap<>();
            extra.put("newEndDate", newEndDate.toString());
            // Message-ready label ("11 Sep 2026") so confirmation templates don't
            // have to parse java.util.Date.toString().
            extra.put("newEndDateLabel", new java.text.SimpleDateFormat("dd MMM yyyy").format(newEndDate));
            emitRenewalEvent(WorkflowTriggerEvent.PAYMENT_SUCCESS, userPlan, instituteId, extra);

        } catch (Exception e) {
            log.error("Error processing successful renewal for UserPlan: {}", userPlan.getId(), e);
        }
    }

    /**
     * Handles failed renewal payment (async gateway path — Razorpay payment.failed webhook).
     *
     * Previously this only called a TODO notification stub, leaving the plan ACTIVE with
     * {@code next_charge_at = NULL} forever (never retried, never expired — the learner kept
     * free access indefinitely). Now it applies the same dunning as the synchronous path:
     * the attempt was already counted by {@code claimForRenewal}, so either re-arm the charge
     * for tomorrow or — on exhaustion — expire the plan and deactivate access. Either way a
     * PAYMENT_FAILED workflow event fires so messaging workflows can react.
     */
    private void handleFailedRenewal(UserPlan userPlan, String instituteId) {
        log.info("Processing failed renewal for UserPlan: {}", userPlan.getId());

        try {
            int attempts = userPlan.getRenewalAttemptCount() != null ? userPlan.getRenewalAttemptCount() : 0;
            // Same rule as the sweep: a configured grace period (end_date + N days) governs;
            // otherwise the attempt ceiling. Keeps the two failure paths from disagreeing.
            boolean exhausted = gracePolicy.isExhausted(userPlan, new Date(), attempts, MAX_RENEWAL_ATTEMPTS);
            if (exhausted) {
                userPlan.setStatus(UserPlanStatusEnum.EXPIRED.name());
                userPlan.setNextChargeAt(null);
                userPlanRepository.save(userPlan);
                List<StudentSessionInstituteGroupMapping> active = mappingRepository
                        .findByUserPlanIdAndStatus(userPlan.getId(), LearnerSessionStatusEnum.ACTIVE.name());
                for (StudentSessionInstituteGroupMapping m : active) {
                    m.setStatus(LearnerSessionStatusEnum.INACTIVE.name());
                    mappingRepository.save(m);
                }
                log.warn("Plan {} exhausted {} renewal attempts (async failure) — expired, {} mapping(s) deactivated",
                        userPlan.getId(), attempts, active.size());
            } else {
                Calendar c = Calendar.getInstance();
                c.add(Calendar.DAY_OF_MONTH, 1);
                userPlan.setNextChargeAt(c.getTime());
                userPlanRepository.save(userPlan);
                log.info("Plan {} async charge failed (attempt {}) — will retry on {}",
                        userPlan.getId(), attempts, c.getTime());
            }

            // Send failure notification to user or ROOT_ADMIN (for SUB_ORG)
            sendRenewalFailureNotification(userPlan, instituteId);

            emitRenewalPaymentFailed(userPlan, instituteId, exhausted);

        } catch (Exception e) {
            log.error("Error processing failed renewal for UserPlan: {}", userPlan.getId(), e);
        }
    }

    /**
     * Fire PAYMENT_FAILED for a failed renewal charge. Public so the synchronous dunning path
     * ({@code RenewalChargeService.applyDunning}) emits through the same code.
     */
    public void emitRenewalPaymentFailed(UserPlan userPlan, String instituteId, boolean finalAttempt) {
        Map<String, Object> extra = new HashMap<>();
        extra.put("finalAttempt", finalAttempt);
        extra.put("attempt", userPlan.getRenewalAttemptCount());
        emitRenewalEvent(WorkflowTriggerEvent.PAYMENT_FAILED, userPlan, instituteId, extra);
    }

    /**
     * Common renewal workflow-event emission. Context mirrors PaymentLogService's initial-payment
     * events (userId/userPlanId/enrollInviteId/packageSessionIds) plus {@code renewal: true} and a
     * full {@code user} DTO (name/mobile/email) so SEND_WHATSAPP nodes can message directly.
     * eventId = enrollInviteId (event_applied_type ENROLL_INVITE), falling back to instituteId.
     * Failures are logged, never propagated — a workflow error must not affect the money path.
     */
    private void emitRenewalEvent(WorkflowTriggerEvent event, UserPlan userPlan, String instituteId,
                                  Map<String, Object> extra) {
        try {
            Map<String, Object> ctx = new HashMap<>(extra != null ? extra : Map.of());
            ctx.put("renewal", true);
            ctx.put("userPlanId", userPlan.getId());
            ctx.put("userId", userPlan.getUserId());
            ctx.put("enrollInviteId", userPlan.getEnrollInviteId());
            ctx.put("vendor", userPlan.getEnrollInvite() != null ? userPlan.getEnrollInvite().getVendor() : null);
            if (userPlan.getPaymentPlan() != null) {
                ctx.put("amount", RegionalPriceLock.listPrice(userPlan));
            }
            // On final-failure the mappings were just flipped INACTIVE before this event,
            // so fall back to INACTIVE rows rather than emitting an empty batch list.
            List<StudentSessionInstituteGroupMapping> mappings = mappingRepository
                    .findByUserPlanIdAndStatus(userPlan.getId(), LearnerSessionStatusEnum.ACTIVE.name());
            if (mappings.isEmpty()) {
                mappings = mappingRepository.findByUserPlanIdAndStatus(
                        userPlan.getId(), LearnerSessionStatusEnum.INACTIVE.name());
            }
            List<String> packageSessionIds = mappings.stream()
                    .filter(m -> m.getPackageSession() != null)
                    .map(m -> m.getPackageSession().getId())
                    .distinct()
                    .toList();
            ctx.put("packageSessionIds", packageSessionIds);
            try {
                List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userPlan.getUserId()));
                if (!users.isEmpty()) {
                    ctx.put("user", users.get(0));
                }
            } catch (Exception ue) {
                log.warn("Could not enrich renewal event with user {}: {}", userPlan.getUserId(), ue.getMessage());
            }
            String eventId = userPlan.getEnrollInviteId() != null ? userPlan.getEnrollInviteId() : instituteId;
            workflowTriggerService.handleTriggerEvents(event.name(), eventId, instituteId, ctx);
        } catch (Exception wfe) {
            log.warn("Failed to trigger {} workflow for renewal of plan {}: {}",
                    event, userPlan.getId(), wfe.getMessage());
        }
    }

    /**
     * Calculates the new end date from the payment plan's real validity, not a
     * hardcoded 30 days. Extends from the current end date when it's still in
     * the future (so consecutive cycles don't drift), otherwise from today.
     */
    private Date calculateNewEndDate(UserPlan userPlan) {
        Date now = new Date();
        Date base = userPlan.getEndDate();
        if (base == null || base.before(now)) {
            base = now;
        }

        int daysToAdd = resolveValidityDays(userPlan);

        Calendar calendar = Calendar.getInstance();
        calendar.setTime(base);
        calendar.add(Calendar.DAY_OF_MONTH, daysToAdd);
        return calendar.getTime();
    }

    /**
     * Validity days for the plan, from the linked PaymentPlan (falling back to
     * the plan snapshot on user_plan.plan_json), defaulting to 30 only if
     * nothing is resolvable. Shared with the plan-change proration, which has to
     * agree with the renewal on how long a plan lasts.
     */
    private int resolveValidityDays(UserPlan userPlan) {
        return PlanValidityResolver.resolveValidityDays(userPlan);
    }

    /**
     * Sends renewal success notification
     */
    private void sendRenewalSuccessNotification(UserPlan userPlan, String instituteId, Date newEndDate) {
        boolean isSubOrg = UserPlanSourceEnum.SUB_ORG.name().equals(userPlan.getSource()) 
            && StringUtils.hasText(userPlan.getSubOrgId());

        if (isSubOrg) {
            // Send to ROOT_ADMIN for SUB_ORG
            log.info("Sending renewal success notification to ROOT_ADMIN for SubOrg: {}", userPlan.getSubOrgId());
            // TODO: Get ROOT_ADMIN and send notification
            // UserDTO rootAdmin = subOrgService.getRootAdminForSubOrg(userPlan.getSubOrgId());
            // notificationService.sendRenewalSuccessEmail(rootAdmin, userPlan, newEndDate);
        } else {
            // Send to individual user
            log.info("Sending renewal success notification to user: {}", userPlan.getUserId());
            // TODO: Get user and send notification
            // UserDTO user = authService.getUserById(userPlan.getUserId());
            // notificationService.sendRenewalSuccessEmail(user, userPlan, newEndDate);
            // When implementing, also append a billing-contact recipient via
            // BillingContactRecipientResolver.buildBillingContactRecipient(userPlan.getUserId(), user.getEmail())
            // so renewal confirmations reach the same billing inbox as the initial invoice.
        }
    }

    /**
     * Sends renewal failure notification
     */
    private void sendRenewalFailureNotification(UserPlan userPlan, String instituteId) {
        boolean isSubOrg = UserPlanSourceEnum.SUB_ORG.name().equals(userPlan.getSource()) 
            && StringUtils.hasText(userPlan.getSubOrgId());

        if (isSubOrg) {
            // Send to ROOT_ADMIN only for SUB_ORG
            log.info("Sending renewal failure notification to ROOT_ADMIN for SubOrg: {}", userPlan.getSubOrgId());
            // TODO: Get ROOT_ADMIN and send notification
            // UserDTO rootAdmin = subOrgService.getRootAdminForSubOrg(userPlan.getSubOrgId());
            // notificationService.sendRenewalFailureEmail(rootAdmin, userPlan);
        } else {
            // Send to individual user
            log.info("Sending renewal failure notification to user: {}", userPlan.getUserId());
            // TODO: Get user and send notification
            // UserDTO user = authService.getUserById(userPlan.getUserId());
            // notificationService.sendRenewalFailureEmail(user, userPlan);
            // When implementing, also append a billing-contact recipient via
            // BillingContactRecipientResolver.buildBillingContactRecipient(userPlan.getUserId(), user.getEmail())
            // so dunning / failed-renewal emails reach the same billing inbox.
        }
    }
}
