package vacademy.io.admin_core_service.features.user_subscription.service;

import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.*;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.util.CollectionUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.util.JsonUtil;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.user_subscription.dto.BalanceLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.CombinedPaymentRowProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogSummaryResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentStatusTotalProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.InstalmentForecastResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.InstalmentProgressProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.LearnerPlanBreakdownDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.MonthDueLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.OutstandingLearnerDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.OutstandingLearnerProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.UpcomingMonthProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.BillingSummaryResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.CollectionSummaryProjection;
import vacademy.io.admin_core_service.features.user_subscription.dto.CollectionSummaryRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.CollectionSummaryResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogFilterRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentLogWithUserPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.SubOrgDetailsDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.UpdatePaymentLogTrackingDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.OrderStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentLogStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanSourceEnum;
import vacademy.io.admin_core_service.features.user_subscription.enums.UserPlanStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.invoice.enums.InvoicePdfPlacement;
import vacademy.io.admin_core_service.features.user_subscription.util.TrialStartResolver;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.dto.PaymentLogInvoiceDTO;
import vacademy.io.admin_core_service.features.invoice.entity.InvoicePaymentLogMapping;
import vacademy.io.common.core.standard_classes.ListService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;
import vacademy.io.common.payment.enums.PaymentStatusEnum;
import vacademy.io.common.logging.SentryLogger;

import vacademy.io.admin_core_service.features.user_subscription.dto.UserPlanDTO;
import vacademy.io.admin_core_service.features.institute_learner.service.LearnerEnrollmentEntryService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.time.ZoneId;
import java.util.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.stream.Collectors;

import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import org.springframework.context.annotation.Lazy;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityDedupeKeys;
import vacademy.io.admin_core_service.features.live_activity.core.LiveActivityRecorder;
import vacademy.io.admin_core_service.features.live_activity.dto.LiveActivityEvent;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityAction;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityActorType;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;

@Service
@Transactional
public class PaymentLogService {

    /**
     * Derived listing status for a PAYMENT_PENDING log older than
     * {@code payments.pending.abandoned-after-hours}. Never persisted — the row keeps its gateway
     * status, only the listing reports it this way.
     */
    public static final String ABANDONED_PAYMENT_STATUS = "ABANDONED";

    private static final Logger log = LoggerFactory.getLogger(PaymentLogService.class);

    @Autowired
    private PaymentLogRepository paymentLogRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private LiveActivityRecorder liveActivityRecorder;

    @Autowired
    public UserPlanService userPlanService;

    @Autowired
    public PaymentNotificatonService paymentNotificatonService;
    @Autowired
    private AuthService authService;

    @Autowired
    private UserPlanRepository userPlanRepository;

    @Autowired
    private PaymentPlanDatesLoader paymentPlanDatesLoader;

    /**
     * How far ahead the Upcoming card looks. Obligations falling due inside this window are
     * reported as expected money, not as due.
     */
    @Value("${payments.due.upcoming-days:30}")
    private int upcomingDays;

    /**
     * A PAYMENT_PENDING log older than this is an abandoned checkout, not a payment in progress.
     * Gateway orders expire long before it (Razorpay's in ~24 h), so nothing older can still
     * complete. Reported as ABANDONED so the cards stop counting it as money in flight.
     */
    @Value("${payments.pending.abandoned-after-hours:24}")
    private long abandonedAfterHours;

    @Autowired
    private vacademy.io.admin_core_service.features.institute.repository.InstituteRepository instituteRepository;

    // @Lazy breaks the InvoiceService <-> PaymentLogService bean cycle (both field-inject
    // each other). Injecting a lazy proxy here lets Spring construct both without the
    // prohibited circular reference; the real bean resolves on first method call.
    @Lazy
    @Autowired
    private InvoiceService invoiceService;

    @Autowired
    private vacademy.io.admin_core_service.features.user_account.service.UserAccountLedgerService userAccountLedgerService;

    @Autowired
    private LearnerEnrollmentEntryService learnerEnrollmentEntryService;

    @Autowired
    private PackageSessionRepository packageSessionRepository;

    @Autowired
    @Lazy
    private vacademy.io.admin_core_service.features.applicant.service.ApplicantService applicantService;

    @Autowired
    private vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository audienceResponseRepository;

    @Autowired
    @Lazy
    private PaymentLogService self;

    @Autowired
    private InvoicePaymentLogMappingRepository invoicePaymentLogMappingRepository;

    @Autowired
    private InvoiceRepository invoiceRepository;

    @Autowired
    private vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService workflowTriggerService;

    public String createPaymentLog(String userId, double paymentAmount, String vendor, String vendorId, String currency,
            UserPlan userPlan) {
        return createPaymentLog(userId, paymentAmount, vendor, vendorId, currency, userPlan, null);
    }

    public String createPaymentLog(String userId, double paymentAmount, String vendor, String vendorId, String currency,
            UserPlan userPlan, String orderId) {
        return createPaymentLog(userId, paymentAmount, vendor, vendorId, currency, userPlan, orderId, null);
    }

    public String createPaymentLog(String userId, double paymentAmount, String vendor, String vendorId, String currency,
            UserPlan userPlan, String orderId, Date paymentDate) {
        log.info("Creating payment log for userId={}, amount={}, vendor={}, currency={}, providedOrderId={}", userId,
                paymentAmount,
                vendor, currency, orderId);

        PaymentLog paymentLog = new PaymentLog();
        paymentLog.setStatus(PaymentLogStatusEnum.INITIATED.name());
        paymentLog.setPaymentAmount(paymentAmount);
        paymentLog.setUserId(userId);
        paymentLog.setPaymentStatus(null);
        paymentLog.setVendor(vendor);
        paymentLog.setVendorId(vendorId);
        paymentLog.setDate(paymentDate != null ? paymentDate : new Date());
        paymentLog.setCurrency(currency);
        paymentLog.setUserPlan(userPlan);

        // If an orderId is provided (e.g. multi-package), store it in a minimal JSON
        // structure
        // so it can be searched later.
        if (StringUtils.hasText(orderId)) {
            paymentLog.setPaymentSpecificData(JsonUtil.toJson(Map.of("originalRequest", Map.of("order_id", orderId))));
        }

        PaymentLog savedLog = savePaymentLog(paymentLog);

        log.info("Payment log created with ID={}", savedLog.getId());

        return savedLog.getId();
    }

    private PaymentLog savePaymentLog(PaymentLog paymentLog) {
        log.debug("Saving payment log: {}", paymentLog);
        return paymentLogRepository.save(paymentLog);
    }

    public void updatePaymentLog(String paymentLogId, String status, String paymentStatus, String paymentSpecificData) {
        log.info("Updating payment log: id={}, status={}, paymentStatus={}", paymentLogId, status, paymentStatus);

        PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId).orElseThrow(() -> {
            log.error("Payment log not found with ID: {}", paymentLogId);
            SentryLogger.logError(new RuntimeException("Payment log not found with ID: " + paymentLogId),
                    "Payment log not found during update", Map.of(
                            "payment.log.id", paymentLogId,
                            "payment.status", status,
                            "payment.payment.status", paymentStatus != null ? paymentStatus : "unknown",
                            "operation", "updatePaymentLog"));
            return new RuntimeException("Payment log not found with ID: " + paymentLogId);
        });

        paymentLog.setStatus(status);
        if (StringUtils.hasText(paymentStatus)) {
            paymentLog.setPaymentStatus(paymentStatus);
        }
        // Note: If paymentStatus is not provided, keep existing value (including null)
        paymentLog.setPaymentSpecificData(paymentSpecificData);

        paymentLogRepository.save(paymentLog);

        log.debug("Payment log updated successfully for ID={}", paymentLogId);

        // When payment is PAID (e.g. synchronous Stripe success), run sync-only
        // post-payment logic:
        // cleanup + invoice generation (and invoice email if enabled). Do NOT call
        // applicant service
        // (that is for applicant flow). applyOperationsOnFirstPayment is run by the
        // enroll flow after
        // handlePayment returns.
        if (PaymentStatusEnum.PAID.name().equals(paymentStatus)) {
            String instituteId = resolveInstituteIdForPaymentLog(paymentLog);
            if (StringUtils.hasText(instituteId)) {
                try {
                    handlePostPaymentLogicForSyncPayment(paymentLog, instituteId);
                } catch (Exception e) {
                    log.error("Post-payment logic failed for payment log {} (invoice/cleanup may be skipped): {}",
                            paymentLogId, e.getMessage(), e);
                    SentryLogger.logError(e, "Post-payment logic failed after 4-arg updatePaymentLog", Map.of(
                            "payment.log.id", paymentLogId,
                            "operation", "handlePostPaymentLogicForSyncPayment"));
                    // Do not rethrow: payment is already recorded as PAID; enrollment flow
                    // continues
                }
            } else {
                log.warn(
                        "Could not resolve instituteId for payment log {}, skipping post-payment logic (e.g. invoice generation)",
                        paymentLogId);
            }
        }
    }

    /**
     * Updates payment log status WITHOUT triggering post-payment logic
     * (no invoice generation, no abandoned-cart cleanup).
     * Used by school enrollment where receipt is handled separately
     * by SchoolFeeReceiptService.
     */

    // for school system
    public void updatePaymentLogOnly(String paymentLogId, String status,
            String paymentStatus, String paymentSpecificData) {
        PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId)
                .orElseThrow(() -> new RuntimeException("Payment log not found: " + paymentLogId));

        paymentLog.setStatus(status);
        if (StringUtils.hasText(paymentStatus)) {
            paymentLog.setPaymentStatus(paymentStatus);
        }
        paymentLog.setPaymentSpecificData(paymentSpecificData);
        paymentLogRepository.save(paymentLog);

        log.info("Payment log updated (no post-payment logic) for ID={}", paymentLogId);
    }

    /**
     * Atomically claims a payment log for paid-processing — flips it to PAID/SUCCESS only if it
     * is not already PAID, returning the rows changed (1 = this caller won and should run the
     * post-payment side effects; 0 = a concurrent webhook event / another replica already
     * claimed it).
     *
     * <p>Runs in its OWN transaction ({@link Propagation#REQUIRES_NEW}) so the PAID transition
     * commits immediately and is visible to the other replicas handling Razorpay's sibling event
     * (payment.captured vs order.paid). This is the dedupe gate that stops a single payment from
     * being allocated more than once across the 4 admin-core-service replicas — a read-then-check
     * guard cannot do this because both events read "not paid" before either commits.</p>
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int claimPaidIfNotAlready(String paymentLogId) {
        return paymentLogRepository.markPaidIfNotAlready(paymentLogId,
                PaymentStatusEnum.PAID.name(), PaymentLogStatusEnum.SUCCESS.name());
    }

    /**
     * Post-payment logic for the 4-arg updatePaymentLog path (synchronous payment,
     * e.g. Stripe same-request success).
     * Runs only cleanup and invoice generation (and invoice email when institute
     * setting is on).
     * Does NOT call applicant service (different use case) or
     * applyOperationsOnFirstPayment (done by enroll flow).
     */
    /**
     * Credits a confirmed plan-linked payment to the learner's account ledger.
     *
     * <p>This belongs to the PaymentLog going PAID — the actual money event — and NOT to
     * plan activation. It used to live inside {@code UserPlanService.applyOperationsOnFirstPayment},
     * which is an activation routine and bails out early on three separate conditions: the
     * plan is already ACTIVE/PENDING, it has no EnrollInvite, or it got stacked behind an
     * existing plan. The credit sat past all three, so — exactly as the method name says —
     * only the FIRST payment of a still-PENDING_FOR_PAYMENT plan was ever credited. Every
     * later charge against an already-active plan (a second fee installment, any top-up)
     * silently posted nothing, and the learner's Due never came down for it.
     *
     * <p>Called from both post-payment hooks so every gateway is covered: the async webhook
     * path ({@code handlePostPaymentLogic}) and the synchronous one
     * ({@code handlePostPaymentLogicForSyncPayment}, used by eWay/Stripe in-request
     * confirmations). Admin invoices and donations are excluded — they carry no UserPlan and
     * are credited by {@code InvoiceService.markAdminInvoicePaidByPaymentLog} instead.
     *
     * <p>Safe to call more than once: {@code recordCreditPayment} de-duplicates on the
     * PaymentLog id, so a payment observed by several paths is credited exactly once.
     * Best-effort — a ledger write must never cost us the enrollment or the invoice.
     */
    private void recordLedgerCreditForPlanPayment(PaymentLog paymentLog, String instituteId) {
        if (paymentLog.getUserPlan() == null
                || paymentLog.getPaymentAmount() == null
                || paymentLog.getPaymentAmount() <= 0
                || !StringUtils.hasText(instituteId)) {
            return;
        }
        try {
            userAccountLedgerService.recordCreditPayment(
                    paymentLog.getUserId(), instituteId,
                    java.math.BigDecimal.valueOf(paymentLog.getPaymentAmount()),
                    StringUtils.hasText(paymentLog.getCurrency()) ? paymentLog.getCurrency() : "INR",
                    "USER_PLAN", paymentLog.getUserPlan().getId(),
                    paymentLog.getId(), null, "Payment received");
        } catch (Exception e) {
            log.error("Failed to record ledger credit for paymentLog={} (userPlan={}): {}",
                    paymentLog.getId(), paymentLog.getUserPlan().getId(), e.getMessage(), e);
        }
    }

    /**
     * The order's figures for the confirmation email, read off the invoice that
     * was just generated for it.
     *
     * The invoice is the only record that spans the whole order: on a multi-course
     * checkout it groups every child payment log, so its totals are what the
     * learner was actually charged. gross is reconstructed as paid + discount
     * rather than stored separately, which keeps the email's arithmetic identical
     * to the attached PDF's by construction.
     *
     * Null when there is nothing worth breaking down, which leaves the email
     * quoting the payment log exactly as it always did.
     */
    // Visible for testing.
    PaymentNotificatonService.OrderAmountSummary orderAmountsFrom(
            InvoiceService.InvoiceGenerationResult invoiceResult, PaymentLog paymentLog) {
        if (invoiceResult == null || invoiceResult.getInvoice() == null) {
            return null;
        }
        try {
            var invoice = invoiceResult.getInvoice();
            double paid = invoice.getTotalAmount() != null ? invoice.getTotalAmount().doubleValue() : 0d;
            double discount = invoice.getDiscountAmount() != null
                    ? invoice.getDiscountAmount().doubleValue()
                    : 0d;
            if (paid <= 0) {
                return null;
            }
            // Only speak for the order when this log really is one SHARE of it.
            //
            // Two other shapes reach here and must keep quoting their own log, as
            // they always have:
            //   * a single-course invoice — one log, its amount IS the order;
            //   * a legacy multi-package order, where every child log already
            //     carries the whole order total (MultiPackageLearnerEnrollService
            //     copies it onto each) and the invoice is priced from plan list
            //     prices instead. Quoting the invoice there would report the
            //     un-discounted sum as the amount paid.
            // A parent/child order is the one case where the log holds strictly
            // less than the order — which is exactly the test below.
            double thisLog = paymentLog.getPaymentAmount() != null ? paymentLog.getPaymentAmount() : 0d;
            if (invoiceResult.getPaymentLogCount() <= 1 || thisLog >= paid - 0.005) {
                return null;
            }
            return new PaymentNotificatonService.OrderAmountSummary(
                    paid + discount, discount, paid, invoiceResult.getPaymentLogCount());
        } catch (Exception e) {
            log.warn("Could not read order amounts from invoice for payment log {}: {}",
                    paymentLog.getId(), e.getMessage());
            return null;
        }
    }

    private void handlePostPaymentLogicForSyncPayment(PaymentLog paymentLog, String instituteId) {
        handlePaymentSuccessEntryCleanup(paymentLog, instituteId);

        if (paymentLog.getUserPlan() == null) {
            // Admin-created invoice: mark invoice as PAID
            if (invoicePaymentLogMappingRepository.findFirstByPaymentLogId(paymentLog.getId()).isPresent()) {
                log.info("Admin invoice payment PAID (sync path) for paymentLogId={}", paymentLog.getId());
                invoiceService.markAdminInvoicePaidByPaymentLog(paymentLog.getId(), instituteId);
            } else {
                log.info("Payment marked as PAID for donation (sync path), sending donation confirmation notification");
                handleDonationPaymentConfirmation(paymentLog, instituteId);
            }
            return;
        }

        recordLedgerCreditForPlanPayment(paymentLog, instituteId);

        if (paymentLog.getPaymentAmount() != null && paymentLog.getPaymentAmount() > 0) {
            scheduleSyncInvoiceAfterCommit(paymentLog, instituteId);
        }
    }

    /**
     * Invoice (and, in consolidated mode, the single payment-confirmation email carrying its PDF)
     * for a synchronous gateway — eWay, Stripe charge_automatically — once the caller's
     * transaction has COMMITTED.
     *
     * <p>This used to run inline, inside the enrolment transaction that created the payment log.
     * InvoiceService saves the invoice in a REQUIRES_NEW transaction, which cannot see that still
     * uncommitted log, so the {@code invoice_payment_log_mapping.payment_log_id} foreign key
     * rejected the insert. The failure marked the shared transaction rollback-only; catching it in
     * {@link #updatePaymentLog} did not clear that, and the commit then failed with "Transaction
     * silently rolled back" — after the card had already been charged, with no payment, plan or
     * invoice left behind. Running after commit makes the payment stand first; the worst case is
     * now a recorded payment without an invoice, which can be regenerated. Same reasoning as
     * {@link InvoiceService#generateInvoiceAfterCommit}.
     *
     * <p>Runs inline when no transaction is active, so a non-transactional caller still gets it.
     */
    void scheduleSyncInvoiceAfterCommit(PaymentLog paymentLog, String instituteId) {
        // Honor the invoice-PDF-placement setting on the synchronous path too. Synchronous gateways
        // confirm the payment in-request and there is NO later webhook to send the confirmation —
        // so in consolidated mode the separate invoice email is suppressed and the single
        // payment-confirmation email (with the PDF attached) is sent from here.
        InvoicePdfPlacement pdfPlacement = invoiceService.getInvoicePdfPlacement(instituteId);
        boolean attachInvoiceToConfirmation = pdfPlacement == InvoicePdfPlacement.PAYMENT_CONFIRMATION_EMAIL;
        String paymentLogId = paymentLog.getId();
        Runnable task = () -> {
            try {
                log.info("Generating invoice for payment log ID: {} (sync path, after commit, pdfPlacement={})",
                        paymentLogId, pdfPlacement);
                InvoiceService.InvoiceGenerationResult invoiceResult =
                        invoiceService.generateInvoiceWithResultForCommittedPayment(
                                paymentLogId, instituteId, /* sendEmail */ !attachInvoiceToConfirmation);
                // Send the consolidated confirmation only on a freshly-generated invoice. A re-run
                // for an already-invoiced payment log means the single email already went out —
                // the webhook path's dedup guard relies on the same signal.
                if (attachInvoiceToConfirmation && invoiceResult != null && !invoiceResult.isAlreadyExisted()) {
                    String invoiceNumber = invoiceResult.getInvoice() != null
                            ? invoiceResult.getInvoice().getInvoiceNumber()
                            : null;
                    // Its own transaction: after commit the caller's has ended, and the email reads
                    // the plan / course through lazy relations of the reloaded log.
                    TransactionTemplate tx = new TransactionTemplate(transactionManager);
                    tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
                    tx.executeWithoutResult(status -> sendSyncPaymentConfirmation(
                            paymentLogRepository.findById(paymentLogId).orElse(paymentLog),
                            instituteId, invoiceResult.getPdfBytes(), invoiceNumber));
                }
            } catch (Exception e) {
                // The payment is committed and must stand; the invoice can be regenerated.
                log.error("Post-commit invoice/confirmation failed for payment log {}: {}",
                        paymentLogId, e.getMessage(), e);
                SentryLogger.logError(e, "Sync-path invoice generation failed after commit",
                        Map.of("payment.log.id", paymentLogId, "operation", "scheduleSyncInvoiceAfterCommit"));
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        } else {
            task.run();
        }
    }

    /**
     * Send the consolidated payment-confirmation email (with the invoice PDF attached) for the
     * synchronous payment path. Synchronous gateways confirm in-request and have no webhook to
     * carry the confirmation, so we send it here. The sync {@code paymentSpecificData} may not hold
     * the full gateway response, so we build a minimal response/request DTO from the PaymentLog
     * itself (amount, currency, id). Best-effort: a failure is logged and never blocks enrollment.
     */
    private void sendSyncPaymentConfirmation(PaymentLog paymentLog, String instituteId,
            byte[] pdfBytes, String invoiceNumber) {
        try {
            if (paymentLog.getUserId() == null) {
                return;
            }
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(paymentLog.getUserId()));
            if (CollectionUtils.isEmpty(users) || users.get(0) == null) {
                return;
            }
            UserDTO userDTO = users.get(0);

            PaymentResponseDTO responseDTO = new PaymentResponseDTO();
            Map<String, Object> responseData = new HashMap<>();
            responseData.put("paymentStatus", PaymentStatusEnum.PAID.name());
            responseData.put("amount", paymentLog.getPaymentAmount());
            responseData.put("transactionId", paymentLog.getId());
            responseDTO.setResponseData(responseData);

            PaymentInitiationRequestDTO requestDTO = new PaymentInitiationRequestDTO();
            requestDTO.setCurrency(paymentLog.getCurrency());
            requestDTO.setEmail(userDTO.getEmail());

            paymentNotificatonService.sendPaymentConfirmationNotification(
                    instituteId, responseDTO, requestDTO, userDTO, pdfBytes, invoiceNumber,
                    invoiceService.resolveCourseDescription(paymentLog.getId()), paymentLog);
        } catch (Exception e) {
            log.error("Failed to send sync-path payment-confirmation email for payment log {}: {}",
                    paymentLog.getId(), e.getMessage(), e);
        }
    }

    /**
     * Resolve institute ID from payment log's user plan and enroll invite (for
     * post-payment logic).
     */
    private String resolveInstituteIdForPaymentLog(PaymentLog paymentLog) {
        if (paymentLog == null) return null;

        // Normal enrollment path: resolve via UserPlan → EnrollInvite
        if (paymentLog.getUserPlan() != null) {
            try {
                if (paymentLog.getUserPlan().getEnrollInvite() != null) {
                    return paymentLog.getUserPlan().getEnrollInvite().getInstituteId();
                }
            } catch (Exception e) {
                log.debug("Could not get instituteId from payment log {}: {}", paymentLog.getId(), e.getMessage());
            }
            return null;
        }

        // Admin-invoice path: resolve via InvoicePaymentLogMapping → Invoice.instituteId
        try {
            return invoicePaymentLogMappingRepository
                    .findFirstByPaymentLogId(paymentLog.getId())
                    .map(m -> m.getInvoice().getInstituteId())
                    .orElse(null);
        } catch (Exception e) {
            log.debug("Could not get instituteId via invoice mapping for payment log {}: {}",
                    paymentLog.getId(), e.getMessage());
        }
        return null;
    }

    /**
     * Legacy method for backward compatibility with existing payment gateways.
     * Delegates to updatePaymentLogsByOrderId.
     * 
     * @param orderId       The order ID from the payment gateway webhook
     * @param paymentStatus The new payment status to set
     * @param instituteId   The institute ID for post-payment processing
     */
    @Transactional
    public void updatePaymentLog(String orderId, String paymentStatus, String instituteId) {
        updatePaymentLogsByOrderId(orderId, paymentStatus, instituteId);
    }

    /**
     * Updates all PaymentLog entries where the orderId is found in
     * payment_specific_data JSON.
     * This method is specifically designed for webhook callbacks (e.g., PhonePe)
     * where
     * the orderId is passed and all related payment logs need to be updated.
     * 
     * @param orderId       The order ID from the payment gateway webhook
     * @param paymentStatus The new payment status to set
     * @param instituteId   The institute ID for post-payment processing
     */
    @Transactional
    public void updatePaymentLogsByOrderId(String orderId, String paymentStatus, String instituteId) {
        log.info("Attempting to update payment logs by Order ID={}, setting paymentStatus={}", orderId, paymentStatus);

        List<PaymentLog> paymentLogs = new ArrayList<>();
        int maxRetries = 10;

        // --- Retry Loop to find by OrderID in JSON or by PK as fallback ---
        for (int i = 0; i < maxRetries; i++) {
            // First check by orderId in originalRequest.order_id JSON path (primary method)
            paymentLogs = paymentLogRepository.findAllByOrderIdInOriginalRequest(orderId);

            // If not found, try the broader search
            if (paymentLogs.isEmpty()) {
                paymentLogs = paymentLogRepository.findAllByOrderIdInJson(orderId);
            }

            // If none found by OrderId, check if the input is actually a PK (legacy/default
            // way)
            if (paymentLogs.isEmpty()) {
                Optional<PaymentLog> logOpt = paymentLogRepository.findById(orderId);
                logOpt.ifPresent(paymentLogs::add);
            }

            if (!paymentLogs.isEmpty()) {
                log.info("Found {} payment logs for ID/Order {} on attempt {}/{}", paymentLogs.size(), orderId, i + 1,
                        maxRetries);
                break;
            }

            if (i < maxRetries - 1) {
                try {
                    log.warn("No payment logs found for {}. Retrying in 2 seconds...", orderId);
                    Thread.sleep(2000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException("Thread interrupted during payment log retry", e);
                }
            }
        }

        // --- Multi-Package Logic: Check for child logs if it's a parent transaction
        // ---
        List<PaymentLog> allLogsToUpdate = new ArrayList<>(paymentLogs);
        for (PaymentLog pLogItem : paymentLogs) {
            try {
                if (StringUtils.hasText(pLogItem.getPaymentSpecificData())) {
                    Map<String, Object> data = JsonUtil.fromJson(pLogItem.getPaymentSpecificData(), Map.class);
                    if (data != null && data.containsKey("childPaymentLogIds")) {
                        List<String> childIds = (List<String>) data.get("childPaymentLogIds");
                        if (childIds != null && !childIds.isEmpty()) {
                            log.info("Parent log {} has {} child logs. Adding them to update list.", pLogItem.getId(),
                                    childIds.size());
                            for (String childId : childIds) {
                                paymentLogRepository.findById(childId).ifPresent(childLog -> {
                                    if (!allLogsToUpdate.contains(childLog)) {
                                        allLogsToUpdate.add(childLog);
                                    }
                                });
                            }
                        }
                    }
                }
            } catch (Exception e) {
                log.warn("Error checking for child logs in payment log {}: {}", pLogItem.getId(), e.getMessage());
            }
        }

        if (allLogsToUpdate.isEmpty()) {
            log.error("No payment logs found after {} retries for ID/Order={}", maxRetries, orderId);
            SentryLogger.SentryEventBuilder.error(new RuntimeException("Payment logs not found after retries"))
                    .withMessage("Payment logs not found after multiple retries")
                    .withTag("order.id", orderId)
                    .withTag("payment.payment.status", paymentStatus)
                    .send();
            throw new RuntimeException("Payment log not found with ID/Order: " + orderId);
        }

        // Logs whose side effects must be skipped in Pass 2: either they were already in
        // the target status when we read them (sequential duplicate event), or the atomic
        // conditional update below returned 0 rows (a concurrent event / another replica
        // won the claim, or a non-PAID event arrived after the log was already PAID).
        Set<String> alreadyInTargetStatus = new HashSet<>();
        for (PaymentLog pLog : allLogsToUpdate) {
            if (paymentStatus.equals(pLog.getPaymentStatus())) {
                alreadyInTargetStatus.add(pLog.getId());
            }
        }

        boolean targetIsPaid = PaymentStatusEnum.PAID.name().equals(paymentStatus);

        // --- Pass 1: Update status of ALL found logs (Parent + Children) ---
        // Both updates are single-statement conditional UPDATEs, atomic at the DB row
        // level, which gives two guarantees a read-then-save could not:
        //  1. Exactly ONE of Razorpay's sibling PAID events (payment.captured vs
        //     order.paid, possibly on different replicas) claims the log and runs the
        //     post-payment side effects.
        //  2. Payment status is monotonic — a late payment.authorized/payment.failed
        //     can never downgrade a log that is already PAID (the root cause of paid
        //     enrollments displaying as PAYMENT_PENDING).
        // The PAID claim also stamps status=SUCCESS, which the ledger credit recording
        // in applyOperationsOnFirstPayment filters on.
        log.info("Starting status update for {} total logs (Parent + Children) for ID/Order {}", allLogsToUpdate.size(),
                orderId);
        for (PaymentLog paymentLog : allLogsToUpdate) {
            try {
                log.info("Updating log {} (UserPlan: {}, Vendor: {}) with status {}",
                        paymentLog.getId(),
                        paymentLog.getUserPlan() != null ? paymentLog.getUserPlan().getId() : "N/A",
                        paymentLog.getVendor(),
                        paymentStatus);

                int updated;
                if (targetIsPaid) {
                    updated = paymentLogRepository.markPaidIfNotAlready(paymentLog.getId(),
                            PaymentStatusEnum.PAID.name(), PaymentLogStatusEnum.SUCCESS.name());
                    // Keep the managed entity consistent with what the bulk update wrote,
                    // so Pass 2 (and any later query resolving to this first-level-cache
                    // instance, e.g. the ledger credit lookup) sees the PAID/SUCCESS state.
                    paymentLog.setPaymentStatus(PaymentStatusEnum.PAID.name());
                    paymentLog.setStatus(PaymentLogStatusEnum.SUCCESS.name());
                } else {
                    updated = paymentLogRepository.updatePaymentStatusIfNotPaid(paymentLog.getId(),
                            paymentStatus, PaymentStatusEnum.PAID.name());
                    if (updated > 0) {
                        paymentLog.setPaymentStatus(paymentStatus);
                    }
                }
                if (updated == 0) {
                    log.info("Log {} not transitioned to {} (already PAID or claimed elsewhere); "
                            + "skipping its side effects.", paymentLog.getId(), paymentStatus);
                    alreadyInTargetStatus.add(paymentLog.getId());
                }
            } catch (Exception e) {
                log.error("Failed to update status for log {}: {}. Continuing with remaining logs.",
                        paymentLog.getId(), e.getMessage());
                SentryLogger.logError(e, "Payment status update failure", Map.of(
                        "payment.log.id", paymentLog.getId(),
                        "order.id", orderId,
                        "payment.status", paymentStatus));
            }
        }

        // --- Pass 2: Run post-payment logic AFTER all statuses are updated ---
        // This ensures that when invoice generation checks for related PAID logs,
        // all sibling logs are already marked as PAID and can be grouped into one invoice.
        // Single-transaction semantics: if any post-payment side effect throws, we log
        // and re-throw so the original exception (not Spring's UnexpectedRollbackException)
        // surfaces to the webhook layer, where it can be stored verbatim in web_hook.notes.
        for (PaymentLog paymentLog : allLogsToUpdate) {
            if (alreadyInTargetStatus.contains(paymentLog.getId())) {
                log.info("Skipping post-payment logic for log {} — already {} (duplicate confirmation event)",
                        paymentLog.getId(), paymentStatus);
                continue;
            }
            try {
                handlePostPaymentLogic(paymentLog, paymentStatus, instituteId);
            } catch (Exception e) {
                log.error("Failed post-payment logic for log {} (orderId={}, status={}).",
                        paymentLog.getId(), orderId, paymentStatus, e);
                SentryLogger.logError(e, "Post-payment logic failure", Map.of(
                        "payment.log.id", paymentLog.getId(),
                        "order.id", orderId,
                        "payment.status", paymentStatus));
                throw e;
            }
        }
    }

    /**
     * Refactored logic to handle actions after status update.
     * Handles both PAID and FAILED statuses for ABANDONED_CART entry management.
     */
    private void handlePostPaymentLogic(PaymentLog paymentLog, String paymentStatus, String instituteId) {
        // Live activity feed, recorded here rather than at the webhook layer.
        //
        // This method runs ONCE per genuine status transition: updatePaymentLogsByOrderId
        // makes an atomic conditional claim in pass 1 and only calls this for logs that were
        // not already in the target status. That matters because one payment produces
        // several inbound signals -- Razorpay emits payment.captured AND order.paid, every
        // provider retries on a non-2xx, /webhook/reprocess replays deliberately, and eWay
        // polling runs on every replica because it has no @SchedulerLock. Hooking any of
        // those would post the same payment two or more times. Do not move this upward.
        recordPaymentLiveActivity(paymentLog, paymentStatus, instituteId);

        // Handle payment failure - create PAYMENT_FAILED entry
        if (PaymentStatusEnum.FAILED.name().equals(paymentStatus)) {
            log.info("Payment FAILED for log {}, handling failure flow", paymentLog.getId());
            handlePaymentFailure(paymentLog, instituteId);
            return;
        }

        if (!PaymentStatusEnum.PAID.name().equals(paymentStatus)) {
            log.info("Payment status is {}, skipping post-payment logic for log {}", paymentStatus, paymentLog.getId());
            return;
        }

        // Handle payment success - mark ABANDONED_CART as DELETED
        handlePaymentSuccessEntryCleanup(paymentLog, instituteId);

        // Check if this is an admin-invoice payment or donation (both have null userPlan)
        if (paymentLog.getUserPlan() == null) {
            if (invoicePaymentLogMappingRepository.findFirstByPaymentLogId(paymentLog.getId()).isPresent()) {
                log.info("Admin invoice payment PAID (webhook path) for paymentLogId={}", paymentLog.getId());
                invoiceService.markAdminInvoicePaidByPaymentLog(paymentLog.getId(), instituteId);
            } else {
                log.info("Payment marked as PAID for donation, sending donation confirmation notification");
                handleDonationPaymentConfirmation(paymentLog, instituteId);
            }
        } else {
            recordLedgerCreditForPlanPayment(paymentLog, instituteId);

            log.info("Payment marked as PAID, triggering applyOperationsOnFirstPayment for userPlan ID={}",
                    paymentLog.getUserPlan().getId());
            userPlanService.applyOperationsOnFirstPayment(paymentLog.getUserPlan());

            // Generate invoice for paid enrollments. Single-transaction semantics:
            // any failure here propagates so the original cause (preserved via
            // VacademyException(msg, cause)) reaches the webhook layer and is
            // stored verbatim in web_hook.error_message. The previous silent
            // catch was harmful — generateInvoice's @Transactional already marked
            // the outer transaction rollback-only, so swallowing didn't actually
            // save the payment, it only deleted the diagnostic info.
            // Resolve where the invoice PDF should land. When the institute opts for
            // PAYMENT_CONFIRMATION_EMAIL we suppress the separate invoice email and attach the PDF
            // to the confirmation email instead — so the learner gets exactly one mail.
            InvoicePdfPlacement pdfPlacement = invoiceService.getInvoicePdfPlacement(instituteId);
            boolean attachInvoiceToConfirmation = pdfPlacement == InvoicePdfPlacement.PAYMENT_CONFIRMATION_EMAIL;
            byte[] invoicePdfBytes = null;
            String invoiceNumber = null;
            // In consolidated mode (the invoice PDF rides on the confirmation email) we reuse the
            // invoice's OWN idempotency as the confirmation dedup signal: if the invoice already
            // existed for this payment log, this is a retried/duplicate webhook and the single email
            // carrying the PDF was already sent on the first delivery — so we skip re-sending it.
            // No extra column/flag needed; it piggybacks on the existing invoice generation guard
            // (existsByPaymentLogId). NOTE: reliable for sequential webhook retries (the realistic
            // Razorpay case); truly-concurrent duplicate deliveries are bounded only as well as
            // invoice generation itself is (the mapping unique key is composite invoice_id+
            // payment_log_id, so concurrency safety would need an atomic guard — out of scope here).
            boolean invoiceAlreadyExisted = false;
            // The ORDER's money, for the one confirmation email that goes out. A
            // multi-course checkout fans out into a child log per course, so this log
            // knows only its own share; the invoice covers the whole order.
            PaymentNotificatonService.OrderAmountSummary orderAmounts = null;
            if (paymentLog.getPaymentAmount() != null && paymentLog.getPaymentAmount() > 0) {
                log.info("Generating invoice for payment log ID: {} (pdfPlacement={})",
                        paymentLog.getId(), pdfPlacement);
                InvoiceService.InvoiceGenerationResult invoiceResult = invoiceService.generateInvoiceWithResult(
                        paymentLog.getUserPlan(),
                        paymentLog,
                        instituteId,
                        /* sendEmail */ !attachInvoiceToConfirmation);
                if (invoiceResult != null) {
                    // The invoice NUMBER is wanted regardless of placement — the confirmation mail
                    // prints it as the receipt number even when the PDF rides on a separate invoice
                    // email. Only the PDF bytes and the dedup signal are placement-specific.
                    invoiceNumber = invoiceResult.getInvoice() != null
                            ? invoiceResult.getInvoice().getInvoiceNumber()
                            : null;
                    if (attachInvoiceToConfirmation) {
                        invoicePdfBytes = invoiceResult.getPdfBytes();
                    }
                    // Captured whatever the placement is: it is the signal that THIS log's
                    // order has already been confirmed to the learner, which is exactly as
                    // true when the PDF travels in its own email. Without it, a four-course
                    // order sent four confirmations under the default placement.
                    invoiceAlreadyExisted = invoiceResult.isAlreadyExisted();
                    orderAmounts = orderAmountsFrom(invoiceResult, paymentLog);
                }
                log.info("Invoice generated successfully for payment log ID: {}", paymentLog.getId());
            }

            // Trigger PAYMENT_SUCCESS workflow — symmetric to the PAYMENT_FAILED
            // emission below. eventId mirrors enrollInviteId (workflows configured
            // with event_applied_type=ENROLL_INVITE match here). Wrapped in try
            // so workflow failures don't roll back the successful payment.
            try {
                UserPlan paidPlan = paymentLog.getUserPlan();
                Map<String, Object> successCtx = new HashMap<>();
                successCtx.put("paymentLog", paymentLog);
                successCtx.put("userId", paymentLog.getUserId());
                successCtx.put("userPlanId", paidPlan.getId());
                successCtx.put("amount", paymentLog.getPaymentAmount());
                successCtx.put("vendor", paymentLog.getVendor());
                successCtx.put("enrollInviteId", paidPlan.getEnrollInviteId());
                // Enrich for SEND_WHATSAPP workflows: PAYMENT_SUCCESS carries neither the
                // learner's phone/name nor a computed date, and no prebuilt QUERY fetches a
                // single learner by userId. Resolving them here keeps the workflow pure config.
                try {
                    List<UserDTO> paidUsers = authService.getUsersFromAuthServiceByUserIds(
                            List.of(paymentLog.getUserId()));
                    if (paidUsers != null && !paidUsers.isEmpty()) {
                        UserDTO paidUser = paidUsers.get(0);
                        successCtx.put("name", paidUser.getFullName());
                        successCtx.put("phone", paidUser.getMobileNumber());
                    }
                } catch (Exception ue) {
                    log.warn("Could not enrich PAYMENT_SUCCESS context with user details: {}", ue.getMessage());
                }
                // Programme start label ("20th July") for welcome templates. Published
                // under both keys: 'nextMonday' for templates already using it, and the
                // accurate 'trialStartDate' for anyone whose start day isn't Monday.
                String startLabel = trialStartLabel(paidPlan);
                successCtx.put("nextMonday", startLabel);
                successCtx.put("trialStartDate", startLabel);
                String successEventId = paidPlan.getEnrollInviteId() != null
                        ? paidPlan.getEnrollInviteId()
                        : instituteId;
                workflowTriggerService.handleTriggerEvents(
                        vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.PAYMENT_SUCCESS.name(),
                        successEventId, instituteId, successCtx);
            } catch (Exception wfe) {
                log.warn("Failed to trigger PAYMENT_SUCCESS workflow", wfe);
            }

            // Applicant sync: only when paying user is an applicant
            // (audience_response.student_user_id + applicant_id).
            // Avoids expensive applicant_stage JSON query on every payment.
            String payingUserId = paymentLog.getUserId();
            boolean isApplicantPayment = false;
            if (StringUtils.hasText(payingUserId)) {
                try {
                    isApplicantPayment = audienceResponseRepository
                            .findFirstByStudentUserIdAndApplicantIdIsNotNull(payingUserId).isPresent();
                } catch (Exception ex) {
                    log.debug("Applicant gate check failed for userId={}: {}", payingUserId, ex.getMessage());
                }
            }
            if (isApplicantPayment) {
                String orderIdToSync = paymentLog.getId();
                try {
                    Map<String, Object> pData = JsonUtil.fromJson(paymentLog.getPaymentSpecificData(), Map.class);
                    if (pData != null && pData.containsKey("originalRequest")) {
                        Map<String, Object> originalReq = (Map<String, Object>) pData.get("originalRequest");
                        if (originalReq != null && originalReq.containsKey("order_id")) {
                            orderIdToSync = (String) originalReq.get("order_id");
                        }
                    }
                } catch (Exception ex) {
                    log.debug("Failed to extract order_id for applicant sync: {}", ex.getMessage());
                }
                self.syncApplicantStageInNewTransaction(orderIdToSync);
            }

            // Parse the paymentSpecificData which now contains both response and original
            // request
            Map<String, Object> paymentData = JsonUtil.fromJson(paymentLog.getPaymentSpecificData(), Map.class);

            if (paymentData == null) {
                log.error("Payment specific data is null for payment log ID: {}", paymentLog.getId());
                SentryLogger.logError(new IllegalStateException("Payment specific data is null"),
                        "Failed to parse payment specific data", Map.of(
                                "payment.log.id", paymentLog.getId(),
                                "payment.status", PaymentStatusEnum.PAID.name(),
                                "user.id", paymentLog.getUserId() != null ? paymentLog.getUserId() : "unknown",
                                "payment.vendor",
                                paymentLog.getVendor() != null ? paymentLog.getVendor() : "unknown",
                                "operation", "parsePaymentData"));
                return;
            }

            // Extract the response - handle nested response_data structure
            Object responseObj = paymentData.get("response");
            PaymentResponseDTO paymentResponseDTO = null;

            if (responseObj != null) {
                // First try to parse as PaymentResponseDTO (which has response_data nested)
                paymentResponseDTO = JsonUtil.fromJson(
                        JsonUtil.toJson(responseObj),
                        PaymentResponseDTO.class);

                if (paymentResponseDTO == null) {
                    paymentResponseDTO = new PaymentResponseDTO();
                }

                if (paymentResponseDTO.getResponseData() == null) {
                    paymentResponseDTO.setResponseData(new HashMap<>());
                }

                paymentResponseDTO.getResponseData().put("paymentStatus", paymentStatus);

                // Ensure amount and transactionId are present for notifications
                if (!paymentResponseDTO.getResponseData().containsKey("amount")) {
                    paymentResponseDTO.getResponseData().put("amount", paymentLog.getPaymentAmount());
                }
                if (!paymentResponseDTO.getResponseData().containsKey("transactionId")) {
                    paymentResponseDTO.getResponseData().put("transactionId", paymentLog.getId());
                }

                // If responseData field is empty but response_data exists, extract it
                if (paymentResponseDTO != null &&
                        (paymentResponseDTO.getResponseData() == null
                                || paymentResponseDTO.getResponseData().isEmpty())) {

                    Map<String, Object> responseMap = (Map<String, Object>) responseObj;
                    if (responseMap.containsKey("response_data")) {
                        // Use the nested response_data as the responseData
                        paymentResponseDTO.setResponseData((Map<String, Object>) responseMap.get("response_data"));
                        log.debug("Extracted nested response_data for payment log ID: {}", paymentLog.getId());
                    }
                }
            }

            PaymentInitiationRequestDTO paymentInitiationRequestDTO = JsonUtil.fromJson(
                    JsonUtil.toJson(paymentData.get("originalRequest")),
                    PaymentInitiationRequestDTO.class);

            if (paymentResponseDTO == null || paymentInitiationRequestDTO == null) {
                log.error("Could not parse response or original request for payment log ID: {}",
                        paymentLog.getId());
                SentryLogger.logError(new IllegalStateException("Failed to parse payment response/request"),
                        "Could not parse payment response or request data", Map.of(
                                "payment.log.id", paymentLog.getId(),
                                "user.id", paymentLog.getUserId() != null ? paymentLog.getUserId() : "unknown",
                                "payment.vendor",
                                paymentLog.getVendor() != null ? paymentLog.getVendor() : "unknown",
                                "has.response", String.valueOf(paymentResponseDTO != null),
                                "has.request", String.valueOf(paymentInitiationRequestDTO != null),
                                "operation", "parsePaymentResponseRequest"));
                // For MultiPackage legacy mapping, ensure instituteId is set
                if (paymentInitiationRequestDTO != null && paymentInitiationRequestDTO.getInstituteId() == null) {
                    paymentInitiationRequestDTO.setInstituteId(instituteId);
                }
                return;
            }

            // Handle case where email is null in originalRequest - extract from
            // gateway-specific request
            if (paymentInitiationRequestDTO.getEmail() == null) {
                String extractedEmail = extractEmailFromGatewayRequest(paymentInitiationRequestDTO,
                        paymentLog.getId());
                if (extractedEmail != null) {
                    paymentInitiationRequestDTO.setEmail(extractedEmail);
                    log.debug("Extracted email from payment gateway request: {}", extractedEmail);
                }
            }

            // One confirmation per ORDER, whatever the PDF placement.
            //
            // The invoice's own idempotency is the signal: if this log's order was
            // already invoiced, the email covering it has already gone out — either
            // by a sibling course of the same multi-course order, or by an earlier
            // delivery of a retried webhook. This used to be gated on the PDF riding
            // along (attachInvoiceToConfirmation), so default-placement institutes
            // still sent one confirmation per course — four for a four-subject order.
            // A genuinely separate payment (a later installment) creates its own log
            // and its own invoice, so it is unaffected.
            if (invoiceAlreadyExisted) {
                log.info("Skipping duplicate payment-confirmation email for payment log {} — its "
                        + "order is already invoiced (sibling course, or retried webhook); the "
                        + "single email covering the whole order was already sent.",
                        paymentLog.getId());
            } else {
                UserDTO userDTO = authService.getUsersFromAuthServiceByUserIds(List.of(paymentLog.getUserId())).get(0);
                paymentNotificatonService.sendPaymentConfirmationNotification(instituteId, paymentResponseDTO,
                        paymentInitiationRequestDTO, userDTO, invoicePdfBytes, invoiceNumber,
                        invoiceService.resolveCourseDescription(paymentLog.getId()), paymentLog,
                        orderAmounts);
            }
        }
    }

    /**
     * Runs applicant sync in a new transaction so that failure (e.g. no applicant
     * stage
     * for learner payments) does not mark the webhook transaction rollback-only.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void syncApplicantStageInNewTransaction(String orderId) {
        try {
            applicantService.handlePaymentSuccess(orderId);
        } catch (Exception e) {
            log.debug("No applicant stage updated for order {}: {}", orderId, e.getMessage());
        }
    }

    /// to do:

    private void handleDonationPaymentConfirmation(PaymentLog paymentLog, String instituteId) {
        try {
            // Parse the paymentSpecificData which now contains both response and original
            // request
            Map<String, Object> paymentData = JsonUtil.fromJson(paymentLog.getPaymentSpecificData(), Map.class);

            if (paymentData == null) {
                log.error("Payment specific data is null for payment log ID: {}", paymentLog.getId());
                SentryLogger.logError(new IllegalStateException("Payment specific data is null for donation"),
                        "Failed to parse donation payment specific data", Map.of(
                                "payment.log.id", paymentLog.getId(),
                                "payment.type", "DONATION",
                                "payment.vendor", paymentLog.getVendor() != null ? paymentLog.getVendor() : "unknown",
                                "operation", "parseDonationPaymentData"));
                return;
            }

            // Extract the original request
            PaymentInitiationRequestDTO originalRequest = JsonUtil.fromJson(
                    JsonUtil.toJson(paymentData.get("originalRequest")),
                    PaymentInitiationRequestDTO.class);

            // Extract the response - handle nested response_data structure
            Object responseObj = paymentData.get("response");
            PaymentResponseDTO paymentResponseDTO = null;

            if (responseObj != null) {
                paymentResponseDTO = JsonUtil.fromJson(
                        JsonUtil.toJson(responseObj),
                        PaymentResponseDTO.class);

                // If responseData field is empty but response_data exists, extract it
                if (paymentResponseDTO != null &&
                        (paymentResponseDTO.getResponseData() == null
                                || paymentResponseDTO.getResponseData().isEmpty())) {

                    Map<String, Object> responseMap = (Map<String, Object>) responseObj;
                    if (responseMap.containsKey("response_data")) {
                        paymentResponseDTO.setResponseData((Map<String, Object>) responseMap.get("response_data"));
                        log.debug("Extracted nested response_data for donation payment log ID: {}", paymentLog.getId());
                    }
                }
            }

            if (originalRequest == null || paymentResponseDTO == null) {
                log.error("Could not parse original request or response for payment log ID: {}", paymentLog.getId());
                SentryLogger.logError(new IllegalStateException("Failed to parse donation payment response/request"),
                        "Could not parse donation payment response or request", Map.of(
                                "payment.log.id", paymentLog.getId(),
                                "payment.type", "DONATION",
                                "payment.vendor", paymentLog.getVendor() != null ? paymentLog.getVendor() : "unknown",
                                "has.response", String.valueOf(paymentResponseDTO != null),
                                "has.request", String.valueOf(originalRequest != null),
                                "operation", "parseDonationResponseRequest"));
                return;
            }

            // Extract email from the original request
            String email = originalRequest.getEmail();
            if (email == null) {
                // Try to extract from gateway-specific request (works for all gateways)
                email = extractEmailFromGatewayRequest(originalRequest, paymentLog.getId());

                if (email != null) {
                    log.debug("Extracted email from payment gateway request for donation: {}", email);
                } else {
                    email = "donation@institute.com";
                    log.warn("No email found in original request for donation payment log ID: {}, using default email",
                            paymentLog.getId());
                }
            }

            paymentNotificatonService.sendDonationPaymentConfirmationNotification(
                    instituteId,
                    paymentResponseDTO,
                    originalRequest,
                    email);
        } catch (Exception e) {
            log.error("Error sending donation payment confirmation notification for payment log ID: {}",
                    paymentLog.getId(), e);
            SentryLogger.SentryEventBuilder.error(e)
                    .withMessage("Failed to send donation payment confirmation notification")
                    .withTag("payment.log.id", paymentLog.getId())
                    .withTag("payment.type", "DONATION")
                    .withTag("payment.vendor", paymentLog.getVendor() != null ? paymentLog.getVendor() : "unknown")
                    .withTag("payment.amount", String.valueOf(paymentLog.getPaymentAmount()))
                    .withTag("operation", "sendDonationNotification")
                    .send();
        }
    }

    /**
     * The zone the per-day series is bucketed in. Interpolated straight into a native query, so an
     * unknown value would surface as a Postgres error rather than a bad chart — anything ZoneId
     * cannot parse is rejected here and falls back to UTC (the pre-existing behaviour).
     */
    private String resolveDayBucketZone(String requestedZone) {
        if (!StringUtils.hasText(requestedZone)) {
            return "UTC";
        }
        try {
            return java.time.ZoneId.of(requestedZone.trim()).getId();
        } catch (java.time.DateTimeException e) {
            log.warn("Ignoring unrecognised collection-summary time zone '{}'; bucketing by UTC",
                    requestedZone);
            return "UTC";
        }
    }

    @Transactional(readOnly = true)
    /**
     * Aggregated PAID collection for an institute (optionally one sub-org) over a
     * UTC date window. Returns the grand total + a per-day series for charting;
     * the days are cut in request.timeZone (default UTC).
     * Omitting the dates yields the all-time total (epoch -> now).
     */
    public CollectionSummaryResponseDTO getCollectionSummary(CollectionSummaryRequestDTO request) {
        LocalDateTime startDate = request.getStartDateInUtc() != null
                ? request.getStartDateInUtc()
                : LocalDateTime.of(1970, 1, 1, 0, 0);
        LocalDateTime endDate = request.getEndDateInUtc() != null
                ? request.getEndDateInUtc()
                : LocalDateTime.now();
        boolean noSubOrg = !StringUtils.hasText(request.getSubOrgId());

        List<CollectionSummaryProjection> rows = paymentLogRepository.getCollectionSummary(
                request.getInstituteId(),
                noSubOrg ? "__none__" : request.getSubOrgId(),
                noSubOrg,
                startDate,
                endDate,
                resolveDayBucketZone(request.getTimeZone()));

        double total = 0d;
        long count = 0L;
        String currency = null;
        List<CollectionSummaryResponseDTO.DailyPoint> daily = new ArrayList<>();
        for (CollectionSummaryProjection row : rows) {
            double amount = row.getAmount() != null ? row.getAmount() : 0d;
            long dayCount = row.getCnt() != null ? row.getCnt() : 0L;
            total += amount;
            count += dayCount;
            if (currency == null && StringUtils.hasText(row.getCurrency())) {
                currency = row.getCurrency();
            }
            daily.add(CollectionSummaryResponseDTO.DailyPoint.builder()
                    .date(row.getDay())
                    .amount(amount)
                    .count(dayCount)
                    .build());
        }

        return CollectionSummaryResponseDTO.builder()
                .totalAmount(total)
                .totalCount(count)
                .currency(currency)
                .daily(daily)
                .build();
    }

    /**
     * Collected / due / upcoming for an institute — the numbers an admin means by those words.
     *
     * Due is deliberately NOT derived from payment_log: that table only holds payments someone
     * actually raised, so an overdue instalment nobody has paid does not appear in it at all. Nor
     * is it plan price minus payments: that counted every abandoned checkout and every coupon
     * discount as debt. Obligations live on the plan — see
     * {@link UserPlanRepository#DUE_OBLIGATION_CTES} for exactly what counts.
     */
    public BillingSummaryResponseDTO getBillingSummary(BillingSummaryRequestDTO request) {
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }
        LocalDateTime startDate = request.getStartDateInUtc() != null
                ? request.getStartDateInUtc()
                : LocalDateTime.of(1970, 1, 1, 0, 0);
        LocalDateTime endDate = request.getEndDateInUtc() != null
                ? request.getEndDateInUtc()
                : LocalDateTime.now();
        boolean noPackageSessions = CollectionUtils.isEmpty(request.getPackageSessionIds());

        BillingSummaryProjection row = userPlanRepository.getBillingSummary(
                request.getInstituteId(),
                startDate,
                endDate,
                noPackageSessions,
                // A native IN (...) needs a non-empty list even when the guard above skips it.
                noPackageSessions ? List.of("__none__") : request.getPackageSessionIds(),
                upcomingDays);

        double collected = row != null && row.getCollected() != null ? row.getCollected() : 0d;
        double due = row != null && row.getDue() != null ? row.getDue() : 0d;
        double upcoming = row != null && row.getUpcoming() != null ? row.getUpcoming() : 0d;

        return BillingSummaryResponseDTO.builder()
                // Total is derived, never read back: the cards must always reconcile.
                .totalBilled(collected + due)
                .collected(collected)
                .due(due)
                .upcoming(upcoming)
                .upcomingDays(upcomingDays)
                .learnersOwing(row != null && row.getLearnersOwing() != null ? row.getLearnersOwing() : 0L)
                .learnersUpcoming(
                        row != null && row.getLearnersUpcoming() != null ? row.getLearnersUpcoming() : 0L)
                .planCount(row != null && row.getPlanCount() != null ? row.getPlanCount() : 0L)
                .instalmentPlanCount(
                        row != null && row.getInstalmentPlanCount() != null ? row.getInstalmentPlanCount() : 0L)
                .livePlanCount(row != null && row.getLivePlanCount() != null ? row.getLivePlanCount() : 0L)
                .activatedWithoutPaymentCount(
                        row != null && row.getActivatedWithoutPaymentCount() != null
                                ? row.getActivatedWithoutPaymentCount()
                                : 0L)
                .outstanding(row != null && row.getOutstanding() != null ? row.getOutstanding() : 0d)
                .learnersOutstanding(
                        row != null && row.getLearnersOutstanding() != null ? row.getLearnersOutstanding() : 0L)
                .upcomingAll(row != null && row.getUpcomingAll() != null ? row.getUpcomingAll() : 0d)
                .learnersUpcomingAll(
                        row != null && row.getLearnersUpcomingAll() != null ? row.getLearnersUpcomingAll() : 0L)
                .nextDueDate(row != null ? row.getNextDueDate() : null)
                .usesInstallments(row != null && Boolean.TRUE.equals(row.getUsesInstallments()))
                .currency(row != null ? row.getCurrency() : null)
                .build();
    }

    /**
     * Every enrolment behind one learner's Due row, cancelled ones included and flagged.
     *
     * The Due list shows a learner as owing a single netted figure; without this an admin who
     * cancelled somebody's plan had no way to confirm the cancellation was actually honoured. Rows
     * with {@code countsTowardsDue = false} contribute 0 and say so.
     */
    public List<LearnerPlanBreakdownDTO> getLearnerPlanBreakdown(
            BillingSummaryRequestDTO request, String userId) {
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }
        if (!StringUtils.hasText(userId)) {
            throw new VacademyException("user_id is required");
        }
        // Same defaults as getOutstandingLearners, so an unfiltered sheet sees an unfiltered row.
        LocalDateTime startDate = request.getStartDateInUtc() != null
                ? request.getStartDateInUtc()
                : LocalDateTime.of(1970, 1, 1, 0, 0);
        LocalDateTime endDate = request.getEndDateInUtc() != null
                ? request.getEndDateInUtc()
                : LocalDateTime.now();
        List<String> packageSessionIds = request.getPackageSessionIds();
        boolean noPackageSessions = packageSessionIds == null || packageSessionIds.isEmpty();
        return userPlanRepository.findLearnerPlanBreakdown(
                request.getInstituteId(), userId, startDate, endDate, noPackageSessions,
                // Postgres rejects an empty IN list, so hand it a value that can never match.
                noPackageSessions ? List.of("__none__") : packageSessionIds,
                upcomingDays).stream()
                .map(row -> {
                    boolean counts = Boolean.TRUE.equals(row.getCountsTowardsDue());
                    return LearnerPlanBreakdownDTO.builder()
                            .userPlanId(row.getUserPlanId())
                            .courseName(row.getCourseName())
                            .planStatus(row.getPlanStatus())
                            .paymentType(row.getPaymentType())
                            .billed(row.getBilled() != null ? row.getBilled() : 0d)
                            .paid(row.getPaid() != null ? row.getPaid() : 0d)
                            // Already 0 for anything that cannot owe — the query applies the rule.
                            .due(row.getDue() != null ? row.getDue() : 0d)
                            .upcoming(row.getUpcoming() != null ? row.getUpcoming() : 0d)
                            .countsTowardsDue(counts)
                            .currency(row.getCurrency())
                            .build();
                })
                .toList();
    }

    /**
     * The learners behind the "Due payment" card — who owes, how much, and how the fee is
     * structured (a CPO learner also gets their instalment position). Same billing rules as the
     * summary, so these rows reconcile with the card above them.
     */
    public Page<OutstandingLearnerDTO> getOutstandingLearners(
            BillingSummaryRequestDTO request, int pageNo, int pageSize) {
        return getOutstandingLearners(request, pageNo, pageSize, false);
    }

    /**
     * @param includeNotYetDue false: the Due list (something already overdue). true: the
     *                         Outstanding list — anyone with a balance still to collect, soonest
     *                         next installment first, with that installment's amount.
     */
    public Page<OutstandingLearnerDTO> getOutstandingLearners(
            BillingSummaryRequestDTO request, int pageNo, int pageSize, boolean includeNotYetDue) {
        return getOutstandingLearners(request, pageNo, pageSize, includeNotYetDue, null);
    }

    /**
     * @param dueMonth optional yyyy-MM. When given, returns only the learners with something
     *                 falling due in that month (one month of the instalment forecast), each with
     *                 {@code monthAmount}; {@code includeNotYetDue} is then irrelevant. Blank keeps
     *                 the Due / Outstanding lists exactly as they were.
     */
    public Page<OutstandingLearnerDTO> getOutstandingLearners(
            BillingSummaryRequestDTO request, int pageNo, int pageSize, boolean includeNotYetDue,
            String dueMonth) {
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }
        YearMonth month = parseDueMonth(dueMonth);
        LocalDateTime startDate = request.getStartDateInUtc() != null
                ? request.getStartDateInUtc()
                : LocalDateTime.of(1970, 1, 1, 0, 0);
        LocalDateTime endDate = request.getEndDateInUtc() != null
                ? request.getEndDateInUtc()
                : LocalDateTime.now();
        boolean noPackageSessions = CollectionUtils.isEmpty(request.getPackageSessionIds());

        List<String> packageSessionIds = noPackageSessions ? List.of("__none__") : request.getPackageSessionIds();
        String search = StringUtils.hasText(request.getSearchString()) ? request.getSearchString().trim() : "";
        boolean noSearch = search.isEmpty();
        String phoneDigits = phoneSearchDigits(search);
        Page<? extends OutstandingLearnerProjection> page;
        if (month != null) {
            page = userPlanRepository.findLearnersDueInMonth(
                    request.getInstituteId(), startDate, endDate, noPackageSessions,
                    packageSessionIds, upcomingDays, month.atDay(1), month.plusMonths(1).atDay(1),
                    noSearch, search, phoneDigits, PageRequest.of(pageNo, pageSize));
        } else if (includeNotYetDue) {
            page = userPlanRepository.findLearnersWithBalance(
                    request.getInstituteId(), startDate, endDate, noPackageSessions,
                    packageSessionIds, upcomingDays, noSearch, search, phoneDigits,
                    PageRequest.of(pageNo, pageSize));
        } else {
            page = userPlanRepository.findOutstandingLearners(
                    request.getInstituteId(), startDate, endDate, noPackageSessions,
                    packageSessionIds, upcomingDays, noSearch, search, phoneDigits,
                    PageRequest.of(pageNo, pageSize));
        }

        // Names/emails/phones live in the auth service, so resolve the page's learners in one call
        // rather than per row.
        List<String> userIds = page.getContent().stream()
                .map(OutstandingLearnerProjection::getUserId)
                .filter(StringUtils::hasText)
                .distinct()
                .collect(Collectors.toList());
        Map<String, UserDTO> users = userIds.isEmpty()
                ? Collections.emptyMap()
                : authService.getUsersFromAuthServiceByUserIds(userIds).stream()
                        .filter(u -> u != null && u.getId() != null)
                        .collect(Collectors.toMap(UserDTO::getId, u -> u, (a, b) -> a));

        List<OutstandingLearnerDTO> content = page.getContent().stream().map(row -> {
            UserDTO user = users.get(row.getUserId());
            BalanceLearnerProjection balance = row instanceof BalanceLearnerProjection b ? b : null;
            return OutstandingLearnerDTO.builder()
                    .outstanding(balance != null ? balance.getOutstanding() : null)
                    .nextDueAmount(balance != null ? balance.getNextDueAmount() : null)
                    .monthAmount(row instanceof MonthDueLearnerProjection m ? m.getMonthAmount() : null)
                    .userId(row.getUserId())
                    .fullName(user != null ? user.getFullName() : null)
                    .email(user != null ? user.getEmail() : null)
                    .mobileNumber(user != null ? user.getMobileNumber() : null)
                    .courseName(row.getCourseName())
                    .paymentType(row.getPaymentType())
                    .planStatus(row.getPlanStatus())
                    .billed(row.getBilled() != null ? row.getBilled() : 0d)
                    .paid(row.getPaid() != null ? row.getPaid() : 0d)
                    .due(row.getDue() != null ? row.getDue() : 0d)
                    .upcoming(row.getUpcoming() != null ? row.getUpcoming() : 0d)
                    .planCount(row.getPlanCount() != null ? row.getPlanCount() : 0L)
                    .pendingInstallments(
                            row.getPendingInstallments() != null ? row.getPendingInstallments() : 0L)
                    .nextDueDate(row.getNextDueDate())
                    .currency(row.getCurrency())
                    .build();
        }).collect(Collectors.toList());

        return new PageImpl<>(content, PageRequest.of(pageNo, pageSize), page.getTotalElements());
    }

    /** yyyy-MM, or null when blank. Anything else is a bad request, not "no filter". */
    private static YearMonth parseDueMonth(String dueMonth) {
        if (!StringUtils.hasText(dueMonth)) {
            return null;
        }
        try {
            return YearMonth.parse(dueMonth.trim());
        } catch (DateTimeParseException e) {
            throw new VacademyException("due_month must be yyyy-MM");
        }
    }

    /**
     * How far an institute's instalment plans have got, and when the rest comes in, month by month.
     * Same window and course scope as {@link #getBillingSummary}, and built on the same obligation
     * rules, so the months add up to its {@code upcomingAll}.
     *
     * Read-only and only asked for by instalment institutes; the Collected / Due / Upcoming figures
     * and their lists are untouched by it.
     */
    public InstalmentForecastResponseDTO getInstalmentForecast(BillingSummaryRequestDTO request) {
        if (!StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }
        LocalDateTime startDate = request.getStartDateInUtc() != null
                ? request.getStartDateInUtc()
                : LocalDateTime.of(1970, 1, 1, 0, 0);
        LocalDateTime endDate = request.getEndDateInUtc() != null
                ? request.getEndDateInUtc()
                : LocalDateTime.now();
        boolean noPackageSessions = CollectionUtils.isEmpty(request.getPackageSessionIds());
        List<String> packageSessionIds = noPackageSessions ? List.of("__none__") : request.getPackageSessionIds();

        InstalmentProgressProjection progress = userPlanRepository.getInstalmentProgress(
                request.getInstituteId(), startDate, endDate, noPackageSessions, packageSessionIds,
                upcomingDays);
        List<UpcomingMonthProjection> monthRows = userPlanRepository.getUpcomingByMonth(
                request.getInstituteId(), startDate, endDate, noPackageSessions, packageSessionIds,
                upcomingDays);

        double overdue = progress != null && progress.getOverdue() != null ? progress.getOverdue() : 0d;
        double outstanding = progress != null && progress.getOutstanding() != null ? progress.getOutstanding() : 0d;

        List<InstalmentForecastResponseDTO.Month> months = monthRows.stream()
                .map(row -> InstalmentForecastResponseDTO.Month.builder()
                        .month(row.getMonthStart() != null ? YearMonth.from(row.getMonthStart()).toString() : null)
                        .amount(row.getAmount() != null ? row.getAmount() : 0d)
                        .learners(row.getLearners() != null ? row.getLearners() : 0L)
                        .dues(row.getDues() != null ? row.getDues() : 0L)
                        .firstDueOn(row.getFirstDueOn())
                        .build())
                .toList();

        return InstalmentForecastResponseDTO.builder()
                .instalmentBilled(progress != null && progress.getBilled() != null ? progress.getBilled() : 0d)
                .instalmentPaid(progress != null && progress.getPaid() != null ? progress.getPaid() : 0d)
                .instalmentOverdue(overdue)
                .instalmentToCome(Math.max(outstanding - overdue, 0d))
                .instalmentPlans(progress != null && progress.getPlans() != null ? progress.getPlans() : 0L)
                .instalmentLearners(
                        progress != null && progress.getLearners() != null ? progress.getLearners() : 0L)
                .months(months)
                .build();
    }

    /**
     * Everything the combined payment query needs, resolved once from a filter set.
     *
     * <p>The list and the summary must see the same rows, so they read their bind values from
     * here rather than each deriving them — a filter fixed in one place is fixed for both.</p>
     */
    private record ResolvedPaymentFilters(
            String instituteId, LocalDateTime startDate, LocalDateTime endDate,
            List<String> paymentStatusesBound, boolean noPaymentStatusFilter,
            List<String> userPlanStatusesBound, boolean noUserPlanStatusFilter,
            List<String> sourcesBound, boolean noSourceFilter,
            List<String> enrollInviteIdsBound, boolean noEnrollInviteFilter,
            List<String> packageSessionIdsBound, boolean noPackageSessionFilter,
            String userId, boolean includeInvoiceLogs,
            boolean noPaymentTypeFilter, boolean typeSubOrgAdmin, boolean typeSubOrgLearner,
            boolean typeLiveClass, boolean typeCourse, boolean typeCpo,
            boolean typeEnrollInvite, boolean typeUserInvoice,
            boolean noSearchFilter, boolean noSearchUserIds,
            List<String> searchUserIdsBound, boolean searchNumeric, String searchString,
            String searchPhoneDigits,
            List<String> paymentPlanNamesBound, boolean noPaymentPlanFilter,
            boolean noBucketFilter, boolean bucketPaid, boolean bucketPending,
            boolean bucketAbandoned, boolean bucketFailed) {
    }

    /**
     * The digits of a search that reads as a phone number, for matching {@code student.mobile_number}
     * whatever way either side is formatted — "+91 95886-97989" and "919588697989" are the same
     * learner. Longer than ten digits keeps the last ten, so a country code on one side only still
     * matches. Anything else (a name, an email, a short amount such as "500") returns "" and the
     * phone match is skipped: a 3-digit fragment would pull in every learner whose number contains it.
     */
    static String phoneSearchDigits(String search) {
        if (search == null || !search.matches("[+0-9()\\s-]+")) {
            return "";
        }
        String digits = search.replaceAll("[^0-9]", "");
        if (digits.length() < 5) {
            return "";
        }
        return digits.length() > 10 ? digits.substring(digits.length() - 10) : digits;
    }

    private ResolvedPaymentFilters resolvePaymentFilters(PaymentLogFilterRequestDTO filterDTO) {
        validateFilter(filterDTO);

        List<String> paymentStatuses = safeList(filterDTO.getPaymentStatuses());
        List<String> enrollInviteIds = safeList(filterDTO.getEnrollInviteIds());
        List<String> packageSessionIds = safeList(filterDTO.getPackageSessionIds());
        List<String> userPlanStatuses = safeList(filterDTO.getUserPlanStatuses());
        List<String> sources = safeList(filterDTO.getSources());
        List<String> paymentTypes = safeList(filterDTO.getPaymentTypes());

        LocalDateTime startDate = resolveStartDate(filterDTO);
        LocalDateTime endDate = resolveEndDate(filterDTO);
        String userId = StringUtils.hasText(filterDTO.getUserId()) ? filterDTO.getUserId() : null;

        // Boolean flags tell the query which IN clauses to skip (PostgreSQL can't type-infer NULL lists).
        // When a filter is inactive, pass a sentinel list so JDBC binding always succeeds.
        boolean noPaymentStatusFilter = paymentStatuses.isEmpty();
        boolean noUserPlanStatusFilter = userPlanStatuses.isEmpty();
        boolean noSourceFilter = sources.isEmpty();
        boolean noEnrollInviteFilter = enrollInviteIds.isEmpty();
        boolean noPackageSessionFilter = packageSessionIds.isEmpty();
        // Payment-type filter: each token maps to a specific predicate in the native query.
        // Values are OR-combined; when the list is empty the type filter is skipped entirely.
        boolean noPaymentTypeFilter = paymentTypes.isEmpty();
        boolean typeSubOrgAdmin = paymentTypes.contains("SUB_ORG_ADMIN");
        boolean typeSubOrgLearner = paymentTypes.contains("SUB_ORG_LEARNER");
        boolean typeLiveClass = paymentTypes.contains("LIVE_CLASS");
        boolean typeCourse = paymentTypes.contains("COURSE");
        boolean typeCpo = paymentTypes.contains("CPO");
        boolean typeEnrollInvite = paymentTypes.contains("ENROLL_INVITE");
        boolean typeUserInvoice = paymentTypes.contains("USER_INVOICE");

        // Invoice-path logs (admin invoices, paid LIVE_SESSION registrations) appear when User Invoice
        // is explicitly requested, or (with no payment-type filter) when no user-plan-only filter
        // (plan status, enroll-invite, package-session) is active. A `sources` filter is honored inside
        // the invoice arm against invoice.source rather than suppressing the whole arm.
        boolean includeInvoiceLogs = typeUserInvoice
                || (noPaymentTypeFilter && noUserPlanStatusFilter
                        && noEnrollInviteFilter && noPackageSessionFilter);

        List<String> SENTINEL = List.of("__none__");
        List<String> paymentStatusesBound = noPaymentStatusFilter ? SENTINEL : paymentStatuses;
        List<String> userPlanStatusesBound = noUserPlanStatusFilter ? SENTINEL : userPlanStatuses;
        List<String> sourcesBound = noSourceFilter ? SENTINEL : sources;
        List<String> enrollInviteIdsBound = noEnrollInviteFilter ? SENTINEL : enrollInviteIds;
        List<String> packageSessionIdsBound = noPackageSessionFilter ? SENTINEL : packageSessionIds;

        // Free-text search: name/email/phone match the learner's student row inside the query, and
        // also resolve through the auth service; the amount matches directly on payment_log. A
        // payment matches if any of them does.
        String statusBucket = StringUtils.hasText(filterDTO.getStatusBucket())
                ? filterDTO.getStatusBucket().trim().toLowerCase()
                : "total";
        boolean noBucketFilter = "total".equals(statusBucket);

        List<String> paymentPlanNames = safeList(filterDTO.getPaymentPlanNames());
        boolean noPaymentPlanFilter = paymentPlanNames.isEmpty();

        String searchString = StringUtils.hasText(filterDTO.getSearchString())
                ? filterDTO.getSearchString().trim()
                : null;
        boolean noSearchFilter = (searchString == null);
        List<String> searchUserIds = Collections.emptyList();
        boolean searchNumeric = false;
        if (!noSearchFilter) {
            // The auth lookup only finds users holding a role in this institute. Learners loaded
            // by a migration often hold none (I2CAN: 0 of 4,450 paying learners), so on its own
            // it matched nobody -- the student-row match in the query is what finds them.
            searchUserIds = authService.searchUserIdsByQuery(searchString, filterDTO.getInstituteId());
            searchNumeric = searchString.matches("[0-9]+(\\.[0-9]+)?");
        }
        boolean noSearchUserIds = searchUserIds.isEmpty();
        List<String> searchUserIdsBound = noSearchUserIds ? SENTINEL : searchUserIds;

        return new ResolvedPaymentFilters(
                filterDTO.getInstituteId(), startDate, endDate,
                paymentStatusesBound, noPaymentStatusFilter,
                userPlanStatusesBound, noUserPlanStatusFilter,
                sourcesBound, noSourceFilter,
                enrollInviteIdsBound, noEnrollInviteFilter,
                packageSessionIdsBound, noPackageSessionFilter,
                userId, includeInvoiceLogs,
                noPaymentTypeFilter, typeSubOrgAdmin, typeSubOrgLearner,
                typeLiveClass, typeCourse, typeCpo,
                typeEnrollInvite, typeUserInvoice,
                noSearchFilter, noSearchUserIds,
                searchUserIdsBound, searchNumeric, searchString,
                phoneSearchDigits(searchString),
                noPaymentPlanFilter ? List.of("") : paymentPlanNames, noPaymentPlanFilter,
                noBucketFilter, "paid".equals(statusBucket), "pending".equals(statusBucket),
                "abandoned".equals(statusBucket), "failed".equals(statusBucket));
    }

    /**
     * Per-status counts and totals for every row the list would return under the same filters.
     * Lets Manage Payments show tiles and tab counts for the whole set while the table itself
     * fetches one page at a time.
     */
    public PaymentLogSummaryResponseDTO getPaymentLogSummary(PaymentLogFilterRequestDTO filterDTO) {
        ResolvedPaymentFilters f = resolvePaymentFilters(filterDTO);
        List<PaymentStatusTotalProjection> rows = paymentLogRepository.aggregateCombinedPaymentLogs(
                f.instituteId(), f.startDate(), f.endDate(),
                f.paymentStatusesBound(), f.noPaymentStatusFilter(),
                f.userPlanStatusesBound(), f.noUserPlanStatusFilter(),
                f.sourcesBound(), f.noSourceFilter(),
                f.enrollInviteIdsBound(), f.noEnrollInviteFilter(),
                f.packageSessionIdsBound(), f.noPackageSessionFilter(),
                f.userId(), f.includeInvoiceLogs(), f.includeInvoiceLogs(),
                f.noPaymentTypeFilter(), f.typeSubOrgAdmin(), f.typeSubOrgLearner(),
                f.typeLiveClass(), f.typeCourse(), f.typeCpo(),
                f.typeEnrollInvite(), f.typeUserInvoice(),
                f.noSearchFilter(), f.noSearchUserIds(),
                f.searchUserIdsBound(), f.searchNumeric(), f.searchString(), f.searchPhoneDigits(),
                f.paymentPlanNamesBound(), f.noPaymentPlanFilter(), abandonedAfterHours);

        List<PaymentLogSummaryResponseDTO.StatusTotal> totals = rows.stream()
                .map(r -> PaymentLogSummaryResponseDTO.StatusTotal.builder()
                        .status(r.getStatus())
                        .currency(r.getCurrency())
                        .dueEligible(r.getDueEligible())
                        .count(r.getRowCount())
                        .amount(r.getTotalAmount() == null ? 0d : r.getTotalAmount())
                        .build())
                .collect(Collectors.toList());
        return PaymentLogSummaryResponseDTO.builder()
                // Cancelled/voided money was never collected and is no longer owed, so it sits in
                // no tile — the headline totals leave it out too, exactly as the cards do.
                .totalCount(totals.stream().filter(t -> !"CANCELLED".equals(t.getStatus()))
                        .mapToLong(PaymentLogSummaryResponseDTO.StatusTotal::getCount).sum())
                .totalAmount(totals.stream().filter(t -> !"CANCELLED".equals(t.getStatus()))
                        .mapToDouble(PaymentLogSummaryResponseDTO.StatusTotal::getAmount).sum())
                .statusTotals(totals)
                // The plan picker lists every plan the institute has, not just the plans surviving
                // the current filters — otherwise selecting one plan would empty the dropdown.
                .paymentPlanNames(paymentLogRepository.findDistinctPaymentPlanNames(f.instituteId()))
                .build();
    }

    public Page<PaymentLogWithUserPlanDTO> getPaymentLogsForInstitute(
            PaymentLogFilterRequestDTO filterDTO,
            int pageNo,
            int pageSize) {

        ResolvedPaymentFilters f = resolvePaymentFilters(filterDTO);

        // Use unsorted pageable — ORDER BY is hardcoded in the native query (created_at DESC)
        Pageable pageable = PageRequest.of(pageNo, pageSize);

        Page<CombinedPaymentRowProjection> idsPage = paymentLogRepository.findCombinedPaymentLogIdsPaginated(
                f.instituteId(), f.startDate(), f.endDate(),
                f.paymentStatusesBound(), f.noPaymentStatusFilter(),
                f.userPlanStatusesBound(), f.noUserPlanStatusFilter(),
                f.sourcesBound(), f.noSourceFilter(),
                f.enrollInviteIdsBound(), f.noEnrollInviteFilter(),
                f.packageSessionIdsBound(), f.noPackageSessionFilter(),
                f.userId(), f.includeInvoiceLogs(), f.includeInvoiceLogs(),
                f.noPaymentTypeFilter(), f.typeSubOrgAdmin(), f.typeSubOrgLearner(),
                f.typeLiveClass(), f.typeCourse(), f.typeCpo(),
                f.typeEnrollInvite(), f.typeUserInvoice(),
                f.noSearchFilter(), f.noSearchUserIds(),
                f.searchUserIdsBound(), f.searchNumeric(), f.searchString(), f.searchPhoneDigits(),
                f.paymentPlanNamesBound(), f.noPaymentPlanFilter(), abandonedAfterHours,
                f.noBucketFilter(), f.bucketPaid(), f.bucketPending(),
                f.bucketAbandoned(), f.bucketFailed(),
                pageable);

        List<CombinedPaymentRowProjection> rows = idsPage.getContent();
        List<String> paymentLogIds = rows.stream()
                .filter(r -> !ROW_TYPE_INVOICE.equals(r.getRowType()))
                .map(CombinedPaymentRowProjection::getRowId)
                .collect(Collectors.toList());
        List<String> unpaidInvoiceIds = rows.stream()
                .filter(r -> ROW_TYPE_INVOICE.equals(r.getRowType()))
                .map(CombinedPaymentRowProjection::getRowId)
                .collect(Collectors.toList());

        List<PaymentLog> paymentLogs = paymentLogIds.isEmpty()
                ? Collections.emptyList()
                : paymentLogRepository.findPaymentLogsWithRelationshipsByIds(paymentLogIds);
        List<Invoice> unpaidInvoices = unpaidInvoiceIds.isEmpty()
                ? Collections.emptyList()
                : invoiceRepository.findAllById(unpaidInvoiceIds);

        // One user lookup for both row kinds — an invoice row's learner is just as likely to be
        // absent from the payment rows as present in them.
        Set<String> allUserIds = new HashSet<>();
        paymentLogs.forEach(pl -> {
            if (pl.getUserId() != null) allUserIds.add(pl.getUserId());
        });
        unpaidInvoices.forEach(inv -> {
            if (inv.getUserId() != null) allUserIds.add(inv.getUserId());
        });
        Map<String, UserDTO> userMap = fetchUsersByIds(allUserIds);
        Map<String, Institute> instituteMap = fetchInstitutes(paymentLogs);

        Map<String, PaymentLogWithUserPlanDTO> byRowId = new HashMap<>();
        paymentLogs.forEach(pl -> byRowId.put(pl.getId(), mapEntityToDTO(pl, userMap, instituteMap)));
        unpaidInvoices.forEach(inv -> byRowId.put(inv.getId(), mapUnpaidInvoiceToDTO(inv, userMap)));
        if (Boolean.TRUE.equals(filterDTO.getIncludePlanDates())) {
            attachPlanDates(byRowId.values());
        }

        // Emit in the order the query established (created_at DESC across both arms).
        List<PaymentLogWithUserPlanDTO> content = rows.stream()
                .map(r -> byRowId.get(r.getRowId()))
                .filter(Objects::nonNull)
                .collect(Collectors.toList());

        return new PageImpl<>(content, pageable, idsPage.getTotalElements());
    }

    /**
     * Fills the optional Enrollment Date / Next Due Date columns for one page of rows, with a single
     * query over the page's plans ({@link UserPlanRepository#findPlanDates}). Only called when the
     * request asks for them. The query runs in its own transaction ({@link PaymentPlanDatesLoader}),
     * so a failure is logged and the page is returned without the two columns instead of failing
     * the whole list. Unpaid invoice rows get their due date in {@link #mapUnpaidInvoiceToDTO}.
     */
    private void attachPlanDates(Collection<PaymentLogWithUserPlanDTO> rows) {
        List<String> planIds = rows.stream()
                .map(PaymentLogWithUserPlanDTO::getUserPlan)
                .filter(Objects::nonNull)
                .map(UserPlanDTO::getId)
                .filter(StringUtils::hasText)
                .distinct()
                .collect(Collectors.toList());
        if (planIds.isEmpty()) {
            return;
        }
        Map<String, PaymentPlanDatesLoader.PlanDates> byPlan;
        try {
            byPlan = paymentPlanDatesLoader.load(planIds);
        } catch (Exception e) {
            log.warn("Could not load enrolment / next-due dates for the payment list: {}", e.getMessage());
            return;
        }
        for (PaymentLogWithUserPlanDTO row : rows) {
            if (row.getUserPlan() == null) continue;
            PaymentPlanDatesLoader.PlanDates d = byPlan.get(row.getUserPlan().getId());
            if (d == null) continue;
            row.setEnrolledDate(d.enrolledDate());
            if (d.nextInstalmentDue() != null) {
                row.setNextDueOn(d.nextInstalmentDue().toString());
            } else if (d.renewalDue() != null) {
                row.setNextDueOn(utcInstant(d.renewalDue()));
            }
        }
    }

    /** A stored UTC timestamp as an ISO instant, so the client can show it in the admin's zone. */
    private static String utcInstant(LocalDateTime utc) {
        return utc.atOffset(java.time.ZoneOffset.UTC).toInstant().toString();
    }

    // -------------------- Helper Methods --------------------

    private void validateFilter(PaymentLogFilterRequestDTO filterDTO) {
        if (filterDTO == null || !StringUtils.hasText(filterDTO.getInstituteId())) {
            throw new VacademyException("Institute ID is required to fetch payment logs.");
        }
    }

    private Sort resolveSort(PaymentLogFilterRequestDTO filterDTO) {
        Sort sort = ListService.createSortObject(filterDTO.getSortColumns());
        return sort.isUnsorted()
                ? Sort.by(Sort.Direction.DESC, "createdAt")
                : sort;
    }

    private List<String> safeList(List<String> list) {
        return CollectionUtils.isEmpty(list) ? Collections.emptyList() : list;
    }

    private LocalDateTime resolveStartDate(PaymentLogFilterRequestDTO filterDTO) {
        return filterDTO.getStartDateInUtc() != null
                ? filterDTO.getStartDateInUtc()
                : LocalDateTime.of(1970, 1, 1, 0, 0);
    }

    private LocalDateTime resolveEndDate(PaymentLogFilterRequestDTO filterDTO) {
        return filterDTO.getEndDateInUtc() != null
                ? filterDTO.getEndDateInUtc()
                : LocalDateTime.now();
    }

    /** Row type marker used by the combined listing query. */
    private static final String ROW_TYPE_INVOICE = "INVOICE";

    private Map<String, UserDTO> fetchUsers(List<PaymentLog> paymentLogs) {
        return fetchUsersByIds(paymentLogs.stream()
                .map(PaymentLog::getUserId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet()));
    }

    private Map<String, UserDTO> fetchUsersByIds(Set<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return Collections.emptyMap();
        }

        List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(new ArrayList<>(userIds));

        return users.stream()
                .collect(Collectors.toMap(
                        UserDTO::getId,
                        u -> u,
                        (existing, replacement) -> existing));
    }

    /**
     * A raised-but-unpaid invoice, shaped like a payment row so the listing can render it beside
     * real payments.
     *
     * <p>The synthetic payment_log carries the invoice's id, amount and date; there is no vendor or
     * transaction because no payment was ever attempted. A voided invoice is marked CANCELLED
     * rather than NOT_INITIATED so the frontend can show it (struck through) while leaving it out
     * of every total — cancelled money is neither collected nor owed.
     */
    private PaymentLogWithUserPlanDTO mapUnpaidInvoiceToDTO(Invoice invoice, Map<String, UserDTO> userMap) {
        PaymentLogDTO synthetic = new PaymentLogDTO();
        synthetic.setId(invoice.getId());
        synthetic.setUserId(invoice.getUserId());
        synthetic.setPaymentStatus(null);
        synthetic.setCurrency(invoice.getCurrency());
        synthetic.setPaymentAmount(invoice.getTotalAmount() != null
                ? invoice.getTotalAmount().doubleValue()
                : null);
        if (invoice.getInvoiceDate() != null) {
            synthetic.setDate(Date.from(invoice.getInvoiceDate().atZone(ZoneId.systemDefault()).toInstant()));
        }
        if (invoice.getCreatedAt() != null) {
            synthetic.setCreatedAt(Date.from(invoice.getCreatedAt().atZone(ZoneId.systemDefault()).toInstant()));
        }

        boolean voided = "REJECTED".equalsIgnoreCase(invoice.getStatus());

        return PaymentLogWithUserPlanDTO.builder()
                .paymentLog(synthetic)
                .userPlan(null)
                .currentPaymentStatus(voided ? "CANCELLED" : "NOT_INITIATED")
                .user(userMap.get(invoice.getUserId()))
                // Still owed unless voided (or somehow already paid). The UTC calendar day, exactly
                // as the Due tab reads an invoice's due date.
                .nextDueOn(voided || "PAID".equalsIgnoreCase(invoice.getStatus()) || invoice.getDueDate() == null
                        ? null
                        : invoice.getDueDate().toLocalDate().toString())
                .invoice(PaymentLogInvoiceDTO.builder()
                        .paymentLogId(invoice.getId())
                        .invoiceId(invoice.getId())
                        .invoiceNumber(invoice.getInvoiceNumber())
                        .invoiceDate(invoice.getInvoiceDate())
                        .status(invoice.getStatus())
                        .totalAmount(invoice.getTotalAmount())
                        .currency(invoice.getCurrency())
                        .hasPdf(StringUtils.hasText(invoice.getPdfFileId()))
                        .build())
                .build();
    }

    private Map<String, Institute> fetchInstitutes(List<PaymentLog> paymentLogs) {
        Set<String> subOrgIds = paymentLogs.stream()
                .map(PaymentLog::getUserPlan)
                .filter(Objects::nonNull)
                .filter(up -> UserPlanSourceEnum.SUB_ORG.name().equals(up.getSource()))
                .map(UserPlan::getSubOrgId)
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());

        if (subOrgIds.isEmpty()) {
            return Collections.emptyMap();
        }

        log.debug("Fetching {} institutes in bulk for subOrgIds: {}", subOrgIds.size(), subOrgIds);

        // Convert Iterable to List
        Iterable<Institute> iterable = instituteRepository.findAllById(subOrgIds);
        List<Institute> institutes = new ArrayList<>();
        iterable.forEach(institutes::add);

        return institutes.stream()
                .collect(Collectors.toMap(
                        Institute::getId,
                        i -> i,
                        (existing, replacement) -> existing));
    }

    private PaymentLogWithUserPlanDTO mapEntityToDTO(PaymentLog paymentLog, Map<String, UserDTO> userMap,
            Map<String, Institute> instituteMap) {
        PaymentLogDTO paymentLogDTO = paymentLog.mapToDTO();

        UserPlanDTO userPlanDTO = null;
        if (paymentLog.getUserPlan() != null) {
            UserPlan userPlan = paymentLog.getUserPlan();
            PaymentOptionDTO paymentOptionDTO = null;
            if (userPlan.getPaymentOption() != null) {
                paymentOptionDTO = userPlan.getPaymentOption().mapToPaymentOptionDTOWithoutPlans();
            }

            PaymentPlanDTO paymentPlanDTO = null;
            if (userPlan.getPaymentPlan() != null) {
                paymentPlanDTO = userPlan.getPaymentPlan().mapToPaymentPlanDTO();
            }

            // Fetch sub-org details from the pre-fetched map
            SubOrgDetailsDTO subOrgDetails = null;
            if (UserPlanSourceEnum.SUB_ORG.name().equals(userPlan.getSource()) &&
                    StringUtils.hasText(userPlan.getSubOrgId())) {
                Institute institute = instituteMap.get(userPlan.getSubOrgId());
                if (institute != null) {
                    subOrgDetails = SubOrgDetailsDTO.builder()
                            .id(institute.getId())
                            .name(institute.getInstituteName())
                            .address(institute.getAddress())
                            .build();
                } else {
                    log.warn("Institute not found in map for subOrgId={} in UserPlan ID={}",
                            userPlan.getSubOrgId(), userPlan.getId());
                }
            }

            userPlanDTO = UserPlanDTO.builder()
                    .id(userPlan.getId())
                    .userId(userPlan.getUserId())
                    .paymentPlanId(userPlan.getPaymentPlanId())
                    .appliedCouponDiscountId(userPlan.getAppliedCouponDiscountId())
                    .appliedCouponDiscountJson(userPlan.getAppliedCouponDiscountJson())
                    .appliedCoupon(vacademy.io.admin_core_service.features.user_subscription.dto.CouponSnapshotDTO
                            .fromJson(userPlan.getAppliedCouponDiscountJson()))
                    .enrollInviteId(userPlan.getEnrollInviteId())
                    .paymentOptionId(userPlan.getPaymentOptionId())
                    .status(userPlan.getStatus())
                    .source(userPlan.getSource())
                    .subOrgDetails(subOrgDetails)
                    .createdAt(userPlan.getCreatedAt())
                    .updatedAt(userPlan.getUpdatedAt())
                    .paymentLogs(null)
                    .enrollInvite(null)
                    .paymentOption(paymentOptionDTO)
                    .paymentPlanDTO(paymentPlanDTO)
                    .enrollInvite(
                            userPlan.getEnrollInvite() != null ? userPlan.getEnrollInvite().toEnrollInviteDTO() : null)
                    .build();
        }

        UserDTO userDTO = null;
        if (paymentLog.getUserId() != null) {
            userDTO = userMap.get(paymentLog.getUserId());
        }

        String currentPaymentStatus = calculateCurrentPaymentStatus(paymentLog);

        return PaymentLogWithUserPlanDTO.builder()
                .paymentLog(paymentLogDTO)
                .userPlan(userPlanDTO)
                .currentPaymentStatus(currentPaymentStatus)
                .user(userDTO)
                .build();
    }

    private String calculateCurrentPaymentStatus(PaymentLog paymentLog) {
        if (paymentLog.getPaymentStatus() == null) {
            return "NOT_INITIATED";
        }

        if (PaymentStatusEnum.PAID.name().equals(paymentLog.getPaymentStatus())) {
            return PaymentStatusEnum.PAID.name();
        }

        // An admin voided this payment (PaymentVoidService). The listing already has a status for
        // "shown struck through, counted in no total" — the one a voided invoice row uses — so
        // report it the same way rather than inventing a second one every screen must learn.
        if (PaymentVoidService.VOIDED.equals(paymentLog.getPaymentStatus())) {
            return "CANCELLED";
        }

        if (PaymentStatusEnum.FAILED.name().equals(paymentLog.getPaymentStatus()) && paymentLog.getUserPlan() != null) {
            UserPlan userPlan = paymentLog.getUserPlan();
            if (userPlan.getEnrollInviteId() != null && userPlan.getUserId() != null) {
                Optional<UserPlan> subsequentActivePlan = userPlanRepository
                        .findFirstByUserIdAndEnrollInviteIdAndCreatedAtAfterOrderByCreatedAtAsc(
                                userPlan.getUserId(),
                                userPlan.getEnrollInviteId(),
                                userPlan.getCreatedAt());

                if (subsequentActivePlan.isPresent()
                        && UserPlanStatusEnum.ACTIVE.equals(subsequentActivePlan.get().getStatus())) {
                    return PaymentStatusEnum.PAID.name();
                }
            }
            return PaymentStatusEnum.FAILED.name();
        }

        // A checkout that was opened and never finished. Gateway orders expire within a day, so
        // a PAYMENT_PENDING row older than the threshold cannot still complete — it is an
        // abandoned cart, and must not be shown as a payment in progress or as money owed.
        if (PaymentStatusEnum.PAYMENT_PENDING.name().equals(paymentLog.getPaymentStatus())
                && paymentLog.getCreatedAt() != null
                && paymentLog.getCreatedAt().plusHours(abandonedAfterHours).isBefore(LocalDateTime.now())) {
            return ABANDONED_PAYMENT_STATUS;
        }

        return paymentLog.getPaymentStatus();
    }

    // This method is no longer needed as the logic is in the SQL query
    // private String determineCurrentPaymentStatus(PaymentLog paymentLog) { ... }

    // This method is no longer needed as the logic is in the SQL query
    // private String resolveFailedPaymentStatus(PaymentLog paymentLog) { ... }

    @Transactional(readOnly = true)
    public PaymentLogDTO getPaymentLog(String paymentLogId) {
        PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId)
                .orElseThrow(() -> new RuntimeException("Payment log not found with ID: " + paymentLogId));
        return paymentLog.mapToDTO();
    }

    /**
     * Updates the tracking fields (tracking_id, tracking_source, order_status)
     * for a specific payment log row. Payment log ID and order status are
     * mandatory; tracking_id and tracking_source are optional (can be added later).
     */
    public void updatePaymentLogTracking(UpdatePaymentLogTrackingDTO dto) {
        // --- Validate required fields ---
        if (!StringUtils.hasText(dto.getPaymentLogId())) {
            throw new VacademyException("Payment log ID must not be empty.");
        }
        if (!StringUtils.hasText(dto.getOrderStatus())) {
            throw new VacademyException("Order status must not be empty.");
        }

        // Validate order status against enum
        OrderStatusEnum validatedStatus = OrderStatusEnum.fromString(dto.getOrderStatus());

        // --- Fetch and update ---
        PaymentLog paymentLog = paymentLogRepository.findById(dto.getPaymentLogId())
                .orElseThrow(() -> new VacademyException(
                        "Payment log not found with ID: " + dto.getPaymentLogId()));

        // Set tracking fields (nullable — tracking info may not be available yet)
        paymentLog.setTrackingId(StringUtils.hasText(dto.getTrackingId()) ? dto.getTrackingId().trim() : null);
        paymentLog.setTrackingSource(StringUtils.hasText(dto.getTrackingSource()) ? dto.getTrackingSource().trim() : null);
        paymentLog.setOrderStatus(validatedStatus.name());

        paymentLogRepository.save(paymentLog);

        log.info("Updated tracking info for payment log ID={}: trackingId={}, trackingSource={}, orderStatus={}",
                dto.getPaymentLogId(), dto.getTrackingId(), dto.getTrackingSource(), validatedStatus.name());
    }

    /**
     * Universal helper method to extract email from any payment gateway request
     * object.
     */
    private String extractEmailFromGatewayRequest(PaymentInitiationRequestDTO request, String paymentLogId) {
        try {
            // Try Razorpay request
            if (request.getRazorpayRequest() != null) {
                Map<String, Object> razorpayRequest = (Map<String, Object>) JsonUtil.fromJson(
                        JsonUtil.toJson(request.getRazorpayRequest()),
                        Map.class);
                if (razorpayRequest != null && razorpayRequest.get("email") != null) {
                    return (String) razorpayRequest.get("email");
                }
            }

            // Try Stripe request
            if (request.getStripeRequest() != null) {
                Map<String, Object> stripeRequest = (Map<String, Object>) JsonUtil.fromJson(
                        JsonUtil.toJson(request.getStripeRequest()),
                        Map.class);
                if (stripeRequest != null && stripeRequest.get("email") != null) {
                    return (String) stripeRequest.get("email");
                }
            }

            // Try PayPal request
            if (request.getPayPalRequest() != null) {
                Map<String, Object> paypalRequest = (Map<String, Object>) JsonUtil.fromJson(
                        JsonUtil.toJson(request.getPayPalRequest()),
                        Map.class);
                if (paypalRequest != null && paypalRequest.get("email") != null) {
                    return (String) paypalRequest.get("email");
                }
            }

            // Try Eway request
            if (request.getEwayRequest() != null) {
                Map<String, Object> ewayRequest = (Map<String, Object>) JsonUtil.fromJson(
                        JsonUtil.toJson(request.getEwayRequest()),
                        Map.class);
                if (ewayRequest != null && ewayRequest.get("email") != null) {
                    return (String) ewayRequest.get("email");
                }
            }

            // Try Manual request
            if (request.getManualRequest() != null) {
                Map<String, Object> manualRequest = (Map<String, Object>) JsonUtil.fromJson(
                        JsonUtil.toJson(request.getManualRequest()),
                        Map.class);
                if (manualRequest != null && manualRequest.get("email") != null) {
                    return (String) manualRequest.get("email");
                }
            }

            log.debug("No email found in any payment gateway request for payment log ID: {}", paymentLogId);
            return null;

        } catch (Exception e) {
            log.warn("Error extracting email from payment gateway request for payment log ID: {}: {}",
                    paymentLogId, e.getMessage());
            return null;
        }
    }

    @Transactional
    public void addChildLogsToPayment(String parentId, List<String> childIds) {
        PaymentLog parentLog = paymentLogRepository.findById(parentId)
                .orElseThrow(() -> new RuntimeException("Parent log not found"));

        Map<String, Object> data = new HashMap<>();
        if (StringUtils.hasText(parentLog.getPaymentSpecificData())) {
            data = JsonUtil.fromJson(parentLog.getPaymentSpecificData(), Map.class);
        }

        List<String> existingChildren = (List<String>) data.getOrDefault("childPaymentLogIds", new ArrayList<>());
        existingChildren.addAll(childIds);
        data.put("childPaymentLogIds", existingChildren);

        String sharedData = JsonUtil.toJson(data);
        parentLog.setPaymentSpecificData(sharedData);
        paymentLogRepository.saveAndFlush(parentLog);

        log.info("Linked {} children to parent {}. Syncing paymentSpecificData to all children.", childIds.size(),
                parentId);

        // Sync the same data to all children so they are easily discoverable by the
        // update-by-orderId query
        for (String childId : childIds) {
            paymentLogRepository.findById(childId).ifPresent(childLog -> {
                childLog.setPaymentSpecificData(sharedData);
                paymentLogRepository.saveAndFlush(childLog);
            });
        }
    }

    /**
     * Handles payment failure by marking ABANDONED_CART entries as DELETED
     * and creating PAYMENT_FAILED entries in the INVITED session.
     */
    private void handlePaymentFailure(PaymentLog paymentLog, String instituteId) {
        try {
            UserPlan userPlan = paymentLog.getUserPlan();
            if (userPlan == null) {
                log.warn("UserPlan is null for payment log {}, skipping failure handling", paymentLog.getId());
                return;
            }

            String userId = paymentLog.getUserId();
            if (userId == null) {
                log.warn("UserId is null for payment log {}, skipping failure handling", paymentLog.getId());
                return;
            }

            // Get package session IDs from user plan's enroll invite
            // This needs to be retrieved from the session mappings associated with this
            // user plan
            List<vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping> mappings = learnerEnrollmentEntryService
                    .findOnlyDetailsFilledEntriesForUserPlan(userId, userPlan.getId(), instituteId);

            for (var mapping : mappings) {
                if (mapping.getDestinationPackageSession() == null || mapping.getPackageSession() == null) {
                    continue;
                }

                String actualPackageSessionId = mapping.getDestinationPackageSession().getId();
                String invitedPackageSessionId = mapping.getPackageSession().getId();

                // Mark ABANDONED_CART entries as DELETED
                learnerEnrollmentEntryService.markPreviousEntriesAsDeleted(
                        userId,
                        invitedPackageSessionId,
                        actualPackageSessionId,
                        instituteId);

                // Create PAYMENT_FAILED entry
                PackageSession invitedSession = mapping.getPackageSession();
                PackageSession actualSession = mapping.getDestinationPackageSession();

                learnerEnrollmentEntryService.createPaymentFailedEntry(
                        userId,
                        invitedSession,
                        actualSession,
                        instituteId,
                        userPlan.getId());

                log.info("Created PAYMENT_FAILED entry for user {} in package session {}",
                        userId, actualPackageSessionId);
            }

            // Update UserPlan status to PAYMENT_FAILED
            userPlan.setStatus(UserPlanStatusEnum.PAYMENT_FAILED.name());
            userPlanRepository.save(userPlan);
            log.info("Updated UserPlan {} status to PAYMENT_FAILED", userPlan.getId());

            // Trigger PAYMENT_FAILED workflow — eventId = enrollInviteId (matches ENROLL_INVITE event_applied_type)
            try {
                Map<String, Object> contextData = new HashMap<>();
                contextData.put("paymentLog", paymentLog);
                contextData.put("userId", userId);
                contextData.put("userPlanId", userPlan.getId());
                contextData.put("amount", paymentLog.getPaymentAmount());
                contextData.put("vendor", paymentLog.getVendor());
                contextData.put("enrollInviteId", userPlan.getEnrollInviteId());
                // Add packageSessionIds from the SSIGM mappings for context
                List<String> packageSessionIds = mappings.stream()
                        .filter(m -> m.getDestinationPackageSession() != null)
                        .map(m -> m.getDestinationPackageSession().getId())
                        .collect(java.util.stream.Collectors.toList());
                contextData.put("packageSessionIds", packageSessionIds);
                // Use enrollInviteId as eventId — users configure PAYMENT_FAILED with event_applied_type=ENROLL_INVITE
                String eventId = userPlan.getEnrollInviteId() != null ? userPlan.getEnrollInviteId() : instituteId;
                workflowTriggerService.handleTriggerEvents(
                        vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent.PAYMENT_FAILED.name(),
                        eventId, instituteId, contextData);
            } catch (Exception wfe) {
                log.warn("Failed to trigger PAYMENT_FAILED workflow", wfe);
            }

        } catch (Exception e) {
            log.error("Error handling payment failure for log {}: {}", paymentLog.getId(), e.getMessage(), e);
            SentryLogger.logError(e, "Payment failure handling error", Map.of(
                    "payment.log.id", paymentLog.getId(),
                    "user.id", paymentLog.getUserId() != null ? paymentLog.getUserId() : "unknown"));
        }
    }

    /**
     * Handles payment success by marking ABANDONED_CART entries as DELETED.
     * The actual ACTIVE entries are created by
     * UserPlanService.applyOperationsOnFirstPayment().
     */
    private void handlePaymentSuccessEntryCleanup(PaymentLog paymentLog, String instituteId) {
        try {
            UserPlan userPlan = paymentLog.getUserPlan();
            if (userPlan == null) {
                log.debug("UserPlan is null for payment log {}, no entry cleanup needed", paymentLog.getId());
                return;
            }

            String userId = paymentLog.getUserId();
            if (userId == null) {
                log.warn("UserId is null for payment log {}, skipping success entry cleanup", paymentLog.getId());
                return;
            }

            // Get ABANDONED_CART entries for this user plan
            List<vacademy.io.admin_core_service.features.institute_learner.entity.StudentSessionInstituteGroupMapping> mappings = learnerEnrollmentEntryService
                    .findOnlyDetailsFilledEntriesForUserPlan(userId, userPlan.getId(), instituteId);

            for (var mapping : mappings) {
                if (mapping.getDestinationPackageSession() == null || mapping.getPackageSession() == null) {
                    continue;
                }

                String actualPackageSessionId = mapping.getDestinationPackageSession().getId();
                String invitedPackageSessionId = mapping.getPackageSession().getId();

                // Mark ABANDONED_CART and PAYMENT_FAILED entries as DELETED
                learnerEnrollmentEntryService.markPreviousEntriesAsDeleted(
                        userId,
                        invitedPackageSessionId,
                        actualPackageSessionId,
                        instituteId);

                log.info(
                        "Marked ABANDONED_CART entries as DELETED for user {} in package session {} on payment success",
                        userId, actualPackageSessionId);
            }

        } catch (Exception e) {
            log.error("Error cleaning up entries on payment success for log {}: {}", paymentLog.getId(), e.getMessage(),
                    e);
            // Don't throw - allow the rest of the payment success flow to continue
        }
    }

    /**
     * The date this learner's programme starts ("3rd August"), for welcome templates.
     *
     * <p>Reads the invite's {@code AUTOPAY_SETTING.TRIAL_STARTS_ON} — the same setting
     * that anchors {@code next_charge_at} in UserPlanService — so an institute starting
     * on Wednesdays announces a Wednesday rather than being told Monday and billed from
     * Wednesday. Falls back to Monday when the invite names no day, preserving the
     * meaning of the long-standing {@code nextMonday} variable.</p>
     *
     * <p>Strictly-next, matching the drip's DELAY node: enrolling ON the start weekday
     * announces the FOLLOWING week, because the first class only runs then too.</p>
     */
    private String trialStartLabel(UserPlan plan) {
        String settingJson = null;
        try {
            if (plan != null && plan.getEnrollInvite() != null) {
                settingJson = plan.getEnrollInvite().getSettingJson();
            }
        } catch (Exception e) {
            log.debug("Could not read invite setting for start-date label: {}", e.getMessage());
        }
        java.time.DayOfWeek day = TrialStartResolver.dayFromInvite(settingJson);
        if (day == null) {
            day = TrialStartResolver.DEFAULT_LABEL_DAY;
        }
        return TrialStartResolver.label(
                TrialStartResolver.nextStart(day, TrialStartResolver.zoneFromInvite(settingJson)));
    }

    /**
     * Mirror a payment outcome onto the live activity feed. Best-effort and never throws --
     * money must not fail because a feed row could not be written.
     */
    private void recordPaymentLiveActivity(PaymentLog paymentLog, String paymentStatus, String instituteId) {
        try {
            LiveActivityAction action;
            if (PaymentStatusEnum.PAID.name().equals(paymentStatus)) {
                action = LiveActivityAction.PAYMENT_SUCCEEDED;
            } else if (PaymentStatusEnum.FAILED.name().equals(paymentStatus)) {
                action = LiveActivityAction.PAYMENT_FAILED;
            } else {
                // PAYMENT_PENDING is not an outcome anyone can act on from a feed.
                return;
            }

            Map<String, Object> payload = new HashMap<>();
            if (paymentLog.getPaymentAmount() != null) {
                payload.put("amount", paymentLog.getPaymentAmount());
            }
            if (paymentLog.getCurrency() != null) {
                payload.put("currency", paymentLog.getCurrency());
            }
            if (paymentLog.getVendor() != null) {
                payload.put("vendor", paymentLog.getVendor());
            }

            liveActivityRecorder.recordAfterCommit(LiveActivityEvent.builder()
                    .instituteId(instituteId)
                    .occurredAtEpochMillis(System.currentTimeMillis())
                    .category(LiveActivityCategory.PAYMENT)
                    .action(action)
                    .actorType(LiveActivityActorType.LEARNER)
                    .dedupeKey(LiveActivityDedupeKeys.forPayment(paymentLog.getId(), paymentStatus))
                    .subjectId(paymentLog.getUserId())
                    .entityId(paymentLog.getId())
                    .payload(payload)
                    .build());
        } catch (Exception e) {
            log.warn("Failed to record live activity for payment log {}: {}",
                    paymentLog.getId(), e.getMessage());
        }
    }
}
