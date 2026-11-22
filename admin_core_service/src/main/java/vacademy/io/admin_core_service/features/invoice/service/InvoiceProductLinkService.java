package vacademy.io.admin_core_service.features.invoice.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.commerce.common.CommerceLegacyGuard;
import vacademy.io.admin_core_service.features.enrollment_policy.service.RenewalPaymentService;
import vacademy.io.admin_core_service.features.institute_learner.enums.LearnerSessionStatusEnum;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceProductLinkDTO;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.event.AdminInvoiceProductLinkEvent;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.learner_management.dto.AssignmentItemDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignOptionsDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignRequestDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignResponseDTO;
import vacademy.io.admin_core_service.features.learner_management.dto.BulkAssignResultItemDTO;
import vacademy.io.admin_core_service.features.learner_management.service.BulkAssignmentService;
import vacademy.io.admin_core_service.features.learner_management.service.DefaultInviteResolver;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.UserPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.AdminManualRenewalService;
import vacademy.io.admin_core_service.features.user_subscription.service.CustomPricePlanService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.math.BigDecimal;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Links an admin invoice to a product (a renewal of a membership the learner holds, or an
 * enrolment in a new course) and applies it once the invoice is paid.
 *
 * <p>The product is checked when the invoice is raised and stored on it as
 * {@code invoice_data_json.product_link} (status PENDING). Both ways an admin invoice gets paid
 * (gateway, or an admin recording an offline payment) publish {@link AdminInvoicePaidEvent};
 * this service then runs the renewal ({@link AdminManualRenewalService#renewFromInvoice}) or
 * the enrolment (the bulk-assign path, with no payment recorded) exactly once and stores the
 * outcome. The invoice's own payment is the money: no second payment, ledger entry or invoice.
 *
 * <p>With "apply now" the renewal / enrolment runs when the invoice is raised instead. Either way,
 * once the invoice is paid its payment is recorded on the membership (payment_log.user_plan_id),
 * so it shows in the membership's payment history. The payment keeps settling the admin invoice:
 * PaymentLogService routes it by its invoice, and the invoice PDF is rebuilt from its own row.
 * Voiding that payment later does not undo the renewal / enrolment.
 *
 * <p>A failure never touches the payment. It is stored as FAILED with the reason, shown on the
 * invoice, and can be retried from the payments tab ({@link #retry}).
 *
 * <h3>Threads and transactions</h3>
 * The paid event is handled after the payment commits. Code running in an after-commit callback
 * still sees that finished transaction and a REQUIRED transaction would join it and never commit,
 * so the work runs on this service's own threads, in the same clean context an API call has.
 * Claiming the link (PENDING to IN_PROGRESS under the invoice row lock) is what makes it
 * run once even when a gateway retries its webhook or an admin double-clicks Retry.
 */
@Slf4j
@Service
public class InvoiceProductLinkService {

    public static final String JSON_KEY = "product_link";

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String INVOICE_STATUS_PAID = "PAID";
    private static final String SOURCE_ADMIN_MANUAL = "ADMIN_MANUAL";
    /** A claim older than this is treated as abandoned (a restart mid-run) and may be retried. */
    private static final long STALE_CLAIM_MINUTES = 10;
    /** How long an admin waits for the renewal / enrolment before the response returns anyway. */
    private static final long WAIT_SECONDS = 60;

    private final InvoiceRepository invoiceRepository;
    private final UserPlanRepository userPlanRepository;
    private final PaymentLogRepository paymentLogRepository;
    private final PaymentPlanRepository paymentPlanRepository;
    private final CustomPricePlanService customPricePlanService;
    private final InvoicePaymentLogMappingRepository invoicePaymentLogMappingRepository;
    private final StudentSessionRepository studentSessionRepository;
    private final DefaultInviteResolver defaultInviteResolver;
    private final CommerceLegacyGuard commerceLegacyGuard;
    private final AdminManualRenewalService adminManualRenewalService;
    private final BulkAssignmentService bulkAssignmentService;
    private final AuthService authService;
    private final TransactionTemplate newTx;
    private final CacheManager cacheManager;
    private final RenewalPaymentService renewalPaymentService;
    private final ExecutorService executor;

    public InvoiceProductLinkService(InvoiceRepository invoiceRepository,
                                     UserPlanRepository userPlanRepository,
                                     PaymentLogRepository paymentLogRepository,
                                     PaymentPlanRepository paymentPlanRepository,
                                     CustomPricePlanService customPricePlanService,
                                     InvoicePaymentLogMappingRepository invoicePaymentLogMappingRepository,
                                     StudentSessionRepository studentSessionRepository,
                                     DefaultInviteResolver defaultInviteResolver,
                                     CommerceLegacyGuard commerceLegacyGuard,
                                     @Lazy AdminManualRenewalService adminManualRenewalService,
                                     @Lazy BulkAssignmentService bulkAssignmentService,
                                     AuthService authService,
                                     PlatformTransactionManager transactionManager,
                                     CacheManager cacheManager,
                                     @Lazy RenewalPaymentService renewalPaymentService) {
        this.invoiceRepository = invoiceRepository;
        this.userPlanRepository = userPlanRepository;
        this.paymentLogRepository = paymentLogRepository;
        this.paymentPlanRepository = paymentPlanRepository;
        this.customPricePlanService = customPricePlanService;
        this.invoicePaymentLogMappingRepository = invoicePaymentLogMappingRepository;
        this.studentSessionRepository = studentSessionRepository;
        this.defaultInviteResolver = defaultInviteResolver;
        this.commerceLegacyGuard = commerceLegacyGuard;
        this.adminManualRenewalService = adminManualRenewalService;
        this.bulkAssignmentService = bulkAssignmentService;
        this.authService = authService;
        this.newTx = new TransactionTemplate(transactionManager);
        this.cacheManager = cacheManager;
        this.renewalPaymentService = renewalPaymentService;
        this.newTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        AtomicInteger n = new AtomicInteger();
        // Own small pool: the shared taskExecutor falls back to running on the caller's thread
        // when busy, which is exactly the after-commit thread this must stay off.
        this.executor = Executors.newFixedThreadPool(2, r -> {
            Thread t = new Thread(r, "invoice-product-link-" + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        });
    }

    @PreDestroy
    void shutdown() {
        executor.shutdown();
    }

    // ───────────────────────────────────────────────────────────── raising the invoice

    /**
     * Checks the admin's product choice before the invoice is raised and returns the copy to
     * store on it (status PENDING, with a label). Null when no product was chosen. Throws with a
     * message for the admin when the product cannot be renewed / enrolled into, so nothing is
     * raised that would fail once the learner has paid.
     *
     * @param invoiceTotal what the invoice charges, checked as the renewal price when the admin
     *                     ticked it; null skips that check (preview, before totals exist)
     */
    @Transactional(readOnly = true)
    public InvoiceProductLinkDTO resolveForCreate(InvoiceProductLinkDTO req, List<String> userIds,
                                                  String instituteId, String adminUserId,
                                                  BigDecimal invoiceTotal, String currency) {
        if (req == null || !StringUtils.hasText(req.getType())) {
            return null;
        }
        if (userIds == null || userIds.size() != 1) {
            throw new VacademyException("A product can only be attached to an invoice for one learner");
        }
        String userId = userIds.get(0);

        InvoiceProductLinkDTO link = new InvoiceProductLinkDTO();
        link.setApplyAsMemberPrice(Boolean.TRUE.equals(req.getApplyAsMemberPrice()));
        link.setApplyNow(Boolean.TRUE.equals(req.getApplyNow()));
        link.setCreatedBy(adminUserId);
        link.setStatus(InvoiceProductLinkDTO.STATUS_PENDING);
        // The admin's renewal price (prefilled from the product line), else the invoice total.
        BigDecimal requestedPrice = req.getRenewalPrice() != null && req.getRenewalPrice().signum() > 0
                ? req.getRenewalPrice().setScale(2, java.math.RoundingMode.HALF_UP) : null;
        BigDecimal renewalPrice = Boolean.TRUE.equals(link.getApplyAsMemberPrice())
                ? (requestedPrice != null ? requestedPrice : invoiceTotal) : null;
        if (Boolean.TRUE.equals(link.getApplyAsMemberPrice())) {
            link.setRenewalPrice(requestedPrice);
        }

        if (req.isRenewal()) {
            if (!StringUtils.hasText(req.getUserPlanId())) {
                throw new VacademyException("Choose the membership this invoice renews");
            }
            link.setType(InvoiceProductLinkDTO.TYPE_RENEWAL);
            link.setUserPlanId(req.getUserPlanId());
            link.setLabel(adminManualRenewalService.describeRenewableForInvoice(
                    req.getUserPlanId(), instituteId, userId, renewalPrice, currency));
            if (StringUtils.hasText(req.getNewEndDate())) {
                LocalDate until = parseDay(req.getNewEndDate());
                if (!until.isAfter(LocalDate.now())) {
                    throw new VacademyException("The renewal's access end date must be in the future");
                }
                link.setNewEndDate(until.toString());
            }
            return link;
        }

        if (req.isNewEnrollment()) {
            if (!StringUtils.hasText(req.getPackageSessionId())) {
                throw new VacademyException("Choose the course this invoice enrols the learner in");
            }
            commerceLegacyGuard.refuseVariantSessions(List.of(req.getPackageSessionId()), "invoice an enrolment into it");
            AssignmentItemDTO item = AssignmentItemDTO.builder()
                    .packageSessionId(req.getPackageSessionId())
                    .enrollInviteId(blankToNull(req.getEnrollInviteId()))
                    .paymentOptionId(blankToNull(req.getPaymentOptionId()))
                    .planId(blankToNull(req.getPlanId()))
                    .build();
            // Dry run: resolves without creating the free default invite a course without one gets.
            DefaultInviteResolver.ResolvedConfig config = defaultInviteResolver.resolve(item, instituteId, true);
            PackageSession ps = config.getPackageSession();
            if (ps != null && Boolean.TRUE.equals(ps.getIsOrgAssociated())) {
                throw new VacademyException("This course enrols learners into an organisation. "
                        + "Enrol the learner from Enrol Learner, then invoice them without a product.");
            }
            if (config.getPaymentOption() != null
                    && PaymentOptionType.CPO.name().equalsIgnoreCase(config.getPaymentOption().getType())) {
                throw new VacademyException("This course is paid in installments (fee plan). "
                        + "Enrol the learner from Enrol Learner; its installments are billed there.");
            }
            if (renewalPrice != null) {
                String refusal = customPricePlanService.refusal(null, config.getPaymentPlan(),
                        config.getPaymentOption(), renewalPrice, currency, instituteId);
                if (refusal != null) {
                    throw new VacademyException(refusal);
                }
            }
            boolean standing = studentSessionRepository.findTopByPackageSessionIdAndUserIdAndStatusIn(
                    req.getPackageSessionId(), instituteId, userId,
                    List.of(LearnerSessionStatusEnum.ACTIVE.name(), LearnerSessionStatusEnum.INVITED.name()))
                    .isPresent();
            if (standing) {
                throw new VacademyException("The learner is already enrolled in this course. "
                        + "Attach the invoice as a renewal of their membership instead.");
            }
            link.setType(InvoiceProductLinkDTO.TYPE_NEW_ENROLLMENT);
            link.setPackageSessionId(req.getPackageSessionId());
            // Pin what the admin saw. A course with no invite gets a free default one at
            // enrolment, as bulk assign does, so nothing is pinned for it.
            if (!config.isAutoCreated()) {
                link.setEnrollInviteId(config.getEnrollInvite() != null ? config.getEnrollInvite().getId() : null);
                link.setPaymentOptionId(config.getPaymentOption() != null ? config.getPaymentOption().getId() : null);
                link.setPlanId(config.getPaymentPlan() != null ? config.getPaymentPlan().getId() : null);
            }
            link.setNotifyLearner(Boolean.TRUE.equals(req.getNotifyLearner()));
            link.setLabel("Enrol · " + courseLabel(ps)
                    + (config.getPaymentPlan() != null && StringUtils.hasText(config.getPaymentPlan().getName())
                            ? " · " + config.getPaymentPlan().getName() : ""));
            return link;
        }

        throw new VacademyException("Unknown product type: " + req.getType());
    }

    // ───────────────────────────────────────────────────────────── once it is paid

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onAdminInvoiceProductLink(AdminInvoiceProductLinkEvent event) {
        try {
            CompletableFuture<InvoiceProductLinkDTO> run =
                    CompletableFuture.supplyAsync(() -> fulfil(event.invoiceId(), false), executor);
            if (event.waitForResult()) {
                run.get(WAIT_SECONDS, TimeUnit.SECONDS);
            }
        } catch (TimeoutException e) {
            log.warn("Product link of invoice {} still running after {}s; it finishes in the background",
                    event.invoiceId(), WAIT_SECONDS);
        } catch (Exception e) {
            // fulfil() stores its own failures; this only covers the hand-off itself.
            log.error("Product link of invoice {} could not be started: {}", event.invoiceId(), e.getMessage(), e);
        }
    }

    /**
     * Admin presses Retry on a paid invoice whose renewal / enrolment failed. Waits for the
     * outcome and returns it.
     */
    public InvoiceProductLinkDTO retry(String invoiceId, String instituteId) {
        Invoice invoice = invoiceRepository.findById(invoiceId)
                .orElseThrow(() -> new VacademyException("Invoice not found: " + invoiceId));
        if (!invoice.getInstituteId().equals(instituteId)) {
            throw new VacademyException("Invoice not found: " + invoiceId);
        }
        InvoiceProductLinkDTO stored = read(invoice);
        if (stored == null) {
            throw new VacademyException("This invoice has no product attached");
        }
        if (!isDue(invoice, stored)) {
            throw new VacademyException("The product is applied once the invoice is paid");
        }
        try {
            return CompletableFuture.supplyAsync(() -> fulfil(invoiceId, true), executor)
                    .get(WAIT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            throw new VacademyException("Still working on it. Refresh in a minute to see the result.");
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            throw cause instanceof VacademyException ve ? ve : new VacademyException(cause.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new VacademyException("Interrupted");
        }
    }

    /**
     * Claims the link, applies it, stores the outcome. Runs on this service's threads.
     *
     * @param manual an admin's retry: refusals (already running) are thrown back to them;
     *               from the paid event they are just logged
     */
    InvoiceProductLinkDTO fulfil(String invoiceId, boolean manual) {
        // Looked up outside the claim's transaction, so the claim loads the invoice only after it
        // holds the row lock (a load before it would be served stale from the session cache).
        String instituteId = invoiceRepository.findById(invoiceId).map(Invoice::getInstituteId).orElse(null);
        if (instituteId == null) {
            return null;
        }
        Claim claim = newTx.execute(status -> claim(invoiceId, instituteId, manual));
        if (claim == null || claim.link() == null || !claim.claimed()) {
            // Applied earlier (apply now, or a run that just finished): a payment that arrived
            // since still has to be recorded on the membership.
            InvoiceProductLinkDTO recorded = recordPaymentOnMembership(invoiceId);
            return recorded != null ? recorded : claim != null ? claim.link() : null;
        }

        InvoiceProductLinkDTO link = claim.link();
        Outcome outcome;
        try {
            outcome = link.isRenewal() ? renew(claim, link) : enrol(claim, link);
        } catch (Exception e) {
            log.warn("Product link of invoice {} ({}) failed: {}", claim.invoiceNumber(), link.getType(), e.getMessage(), e);
            outcome = Outcome.failed(e.getMessage());
        }

        Outcome result = outcome;
        InvoiceProductLinkDTO recorded = newTx.execute(status -> record(invoiceId, result));
        InvoiceProductLinkDTO withPayment = recordPaymentOnMembership(invoiceId);
        return withPayment != null ? withPayment : recorded;
    }

    /**
     * Once the invoice is paid and its product applied, records its paid payment(s) on the
     * membership the product renewed / created, so the membership's payment history shows it.
     * Idempotent; a failure is logged and leaves the invoice and its product as they are.
     * Returns the updated link when something was recorded, else null.
     */
    private InvoiceProductLinkDTO recordPaymentOnMembership(String invoiceId) {
        try {
            InvoiceProductLinkDTO link = newTx.execute(status -> {
                Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
                InvoiceProductLinkDTO link = invoice != null ? read(invoice) : null;
                if (link == null || !InvoiceProductLinkDTO.STATUS_FULFILLED.equals(link.getStatus())
                        || !StringUtils.hasText(link.getResultUserPlanId())
                        || !INVOICE_STATUS_PAID.equalsIgnoreCase(invoice.getStatus())
                        || Boolean.TRUE.equals(link.getPaymentRecorded())) {
                    return null;
                }
                UserPlan plan = userPlanRepository.findById(link.getResultUserPlanId()).orElse(null);
                if (plan == null) {
                    return null;
                }
                int recorded = 0;
                for (String paymentLogId : invoicePaymentLogMappingRepository.findPaymentLogIdsByInvoiceId(invoiceId)) {
                    PaymentLog paymentLog = paymentLogRepository.findById(paymentLogId).orElse(null);
                    // Only the payment that settled it: abandoned gateway attempts stay off the plan.
                    if (paymentLog == null || paymentLog.getUserPlan() != null
                            || !INVOICE_STATUS_PAID.equalsIgnoreCase(paymentLog.getPaymentStatus())) {
                        continue;
                    }
                    paymentLog.setUserPlan(plan);
                    paymentLogRepository.save(paymentLog);
                    recorded++;
                }
                link.setPaymentRecorded(true);
                write(invoice, link);
                log.info("Invoice {}: {} payment(s) recorded on membership {}",
                        invoice.getInvoiceNumber(), recorded, plan.getId());
                return link;
            });
            if (link != null && link.isRenewal()) {
                // The money is in and the renewal applied: the institute's renewal workflows run now,
                // once (paymentRecorded guards it), as they do for a gateway renewal. A new enrolment
                // already ran the enrolment workflow when it was enrolled.
                try {
                    Invoice paid = invoiceRepository.findById(invoiceId).orElse(null);
                    renewalPaymentService.emitInvoiceRenewalPaid(link.getResultUserPlanId(),
                            paid != null ? paid.getInstituteId() : null, paid != null ? paid.getInvoiceNumber() : null);
                } catch (Exception e) {
                    log.warn("Invoice {}: renewal workflows not triggered: {}", invoiceId, e.getMessage());
                }
            }
            if (link != null) {
                // Same plan caches a renewal clears, so the membership shows the payment now.
                for (String name : List.of("userPlanById", "userPlanWithPaymentLogs", "membershipDetails")) {
                    org.springframework.cache.Cache cache = cacheManager.getCache(name);
                    if (cache != null) {
                        cache.clear();
                    }
                }
            }
            return link;
        } catch (Exception e) {
            log.error("Invoice {}: could not record its payment on the membership: {}", invoiceId, e.getMessage(), e);
            return null;
        }
    }

    /** Paid, or raised with apply now and not cancelled. */
    private static boolean isDue(Invoice invoice, InvoiceProductLinkDTO link) {
        if (!SOURCE_ADMIN_MANUAL.equals(invoice.getSource())) {
            return false;
        }
        String status = invoice.getStatus() == null ? "" : invoice.getStatus().toUpperCase();
        return INVOICE_STATUS_PAID.equals(status)
                || (Boolean.TRUE.equals(link.getApplyNow()) && "PENDING_PAYMENT".equals(status));
    }

    private Claim claim(String invoiceId, String instituteId, boolean manual) {
        // Lock first: a webhook retry or a second Retry click waits here, then sees the claim.
        if (invoiceRepository.lockForCredit(instituteId, invoiceId) == null) {
            return null;
        }
        Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
        InvoiceProductLinkDTO link = invoice != null ? read(invoice) : null;
        if (link == null) {
            return null;
        }
        boolean payable = isDue(invoice, link);
        boolean done = InvoiceProductLinkDTO.STATUS_FULFILLED.equals(link.getStatus());
        boolean running = InvoiceProductLinkDTO.STATUS_IN_PROGRESS.equals(link.getStatus())
                && !isStale(link.getAttemptedAt());
        if (running && manual) {
            throw new VacademyException("This is already being applied. Refresh in a minute.");
        }
        boolean claimed = payable && !done && !running;
        if (claimed) {
            link.setStatus(InvoiceProductLinkDTO.STATUS_IN_PROGRESS);
            link.setAttemptedAt(LocalDateTime.now().toString());
            link.setError(null);
            write(invoice, link);
        }
        return new Claim(claimed, link, invoiceId, invoice.getInstituteId(), invoice.getUserId(),
                invoice.getInvoiceNumber(), invoice.getTotalAmount(), invoice.getCurrency());
    }

    private Outcome renew(Claim claim, InvoiceProductLinkDTO link) {
        Date requested = StringUtils.hasText(link.getNewEndDate())
                ? Date.from(parseDay(link.getNewEndDate()).atTime(23, 59, 59).atZone(ZoneId.systemDefault()).toInstant())
                : null;
        boolean setPrice = Boolean.TRUE.equals(link.getApplyAsMemberPrice());
        AdminManualRenewalService.InvoiceRenewalResult renewed = adminManualRenewalService.renewFromInvoice(
                new AdminManualRenewalService.InvoiceRenewal(link.getUserPlanId(), claim.instituteId(),
                        amountOf(claim), claim.currency(), requested, setPrice, renewalPriceOf(claim, link),
                        claim.invoiceId(), claim.invoiceNumber(), link.getCreatedBy(), actorName(link.getCreatedBy())));
        return new Outcome(true, renewed.result().getUserPlanId(), renewed.result().getNewEndDate(),
                renewed.pricePlan(), renewed.priceWarning() != null
                        ? "Renewed, but the renewal price was not changed: " + renewed.priceWarning() : null);
    }

    private Outcome enrol(Claim claim, InvoiceProductLinkDTO link) {
        // With a renewal price, the learner is enrolled straight onto a plan at the invoice amount
        // (same payment option, validity and currency), so their renewals charge it. Worked out
        // before enrolling, so a failure here leaves nothing behind and can be retried.
        String planId = link.getPlanId();
        PaymentPlan pricePlan = null;
        String priceWarning = null;
        if (Boolean.TRUE.equals(link.getApplyAsMemberPrice())) {
            PaymentPlan base = StringUtils.hasText(planId) ? paymentPlanRepository.findById(planId).orElse(null) : null;
            BigDecimal price = renewalPriceOf(claim, link);
            priceWarning = customPricePlanService.refusal(null, base, base != null ? base.getPaymentOption() : null,
                    price, claim.currency(), claim.instituteId());
            if (priceWarning == null) {
                pricePlan = customPricePlanService.findOrCreate(base, price, claim.invoiceNumber());
                planId = pricePlan.getId();
            }
        }
        AssignmentItemDTO item = AssignmentItemDTO.builder()
                .packageSessionId(link.getPackageSessionId())
                .enrollInviteId(link.getEnrollInviteId())
                .paymentOptionId(link.getPaymentOptionId())
                .planId(planId)
                .build();
        // No payment date / transaction id / reference: bulk assign then records no payment, so
        // the invoice's payment stays the only one (no second log, ledger row or invoice).
        BulkAssignRequestDTO request = BulkAssignRequestDTO.builder()
                .instituteId(claim.instituteId())
                .userIds(new ArrayList<>(List.of(claim.userId())))
                .assignments(List.of(item))
                .options(BulkAssignOptionsDTO.builder()
                        .duplicateHandling("ERROR")
                        .notifyLearners(Boolean.TRUE.equals(link.getNotifyLearner()))
                        .sendCredentials(false)
                        .dryRun(false)
                        .build())
                .build();
        BulkAssignResponseDTO response = bulkAssignmentService.bulkAssign(request, link.getCreatedBy());
        BulkAssignResultItemDTO row = response.getResults() == null ? null
                : response.getResults().stream().filter(r -> claim.userId().equals(r.getUserId())).findFirst()
                        .orElse(response.getResults().isEmpty() ? null : response.getResults().get(0));
        if (row == null || !"SUCCESS".equals(row.getStatus()) || !StringUtils.hasText(row.getUserPlanId())) {
            return Outcome.failed(row != null && StringUtils.hasText(row.getMessage())
                    ? row.getMessage() : "The enrolment did not go through");
        }

        Date end = userPlanRepository.findById(row.getUserPlanId()).map(UserPlan::getEndDate).orElse(null);
        return new Outcome(true, row.getUserPlanId(), end, pricePlan,
                priceWarning != null ? "Enrolled on the plan's own price: " + priceWarning : null);
    }

    private InvoiceProductLinkDTO record(String invoiceId, Outcome outcome) {
        Invoice invoice = invoiceRepository.findById(invoiceId).orElse(null);
        if (invoice == null) {
            return null;
        }
        InvoiceProductLinkDTO link = read(invoice);
        if (link == null) {
            return null;
        }
        if (outcome.ok()) {
            link.setStatus(InvoiceProductLinkDTO.STATUS_FULFILLED);
            link.setFulfilledAt(LocalDateTime.now().toString());
            link.setResultUserPlanId(outcome.userPlanId());
            link.setResultEndDate(outcome.endDate() != null
                    ? new SimpleDateFormat("yyyy-MM-dd").format(outcome.endDate()) : null);
            if (outcome.pricePlan() != null) {
                link.setRenewalPrice(BigDecimal.valueOf(outcome.pricePlan().getActualPrice()));
                link.setPricePlanId(outcome.pricePlan().getId());
                link.setPricePlanName(outcome.pricePlan().getName());
            }
            link.setError(outcome.error());
        } else {
            link.setStatus(InvoiceProductLinkDTO.STATUS_FAILED);
            link.setError(StringUtils.hasText(outcome.error()) ? outcome.error() : "Unknown error");
        }
        write(invoice, link);
        log.info("Product link of invoice {} ({}): {}{}", invoice.getInvoiceNumber(), link.getType(),
                link.getStatus(), link.getError() != null ? " - " + link.getError() : "");
        return link;
    }

    // ───────────────────────────────────────────────────────────── stored copy

    /** The product stored on an invoice, or null. */
    @SuppressWarnings("unchecked")
    public static InvoiceProductLinkDTO read(String invoiceDataJson) {
        if (!StringUtils.hasText(invoiceDataJson)) {
            return null;
        }
        try {
            Map<String, Object> data = MAPPER.readValue(invoiceDataJson, Map.class);
            Object raw = data.get(JSON_KEY);
            return raw instanceof Map<?, ?> ? MAPPER.convertValue(raw, InvoiceProductLinkDTO.class) : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** The JSON-ready map stored under {@value #JSON_KEY}. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> toStored(InvoiceProductLinkDTO link) {
        return MAPPER.convertValue(link, Map.class);
    }

    private static InvoiceProductLinkDTO read(Invoice invoice) {
        return read(invoice.getInvoiceDataJson());
    }

    @SuppressWarnings("unchecked")
    private void write(Invoice invoice, InvoiceProductLinkDTO link) {
        try {
            Map<String, Object> data = StringUtils.hasText(invoice.getInvoiceDataJson())
                    ? new HashMap<>(MAPPER.readValue(invoice.getInvoiceDataJson(), Map.class))
                    : new HashMap<>();
            data.put(JSON_KEY, toStored(link));
            invoice.setInvoiceDataJson(MAPPER.writeValueAsString(data));
            invoiceRepository.save(invoice);
        } catch (Exception e) {
            throw new VacademyException("Could not save the invoice's product state: " + e.getMessage());
        }
    }

    // ───────────────────────────────────────────────────────────── helpers

    private String actorName(String userId) {
        if (!StringUtils.hasText(userId)) {
            return "Admin";
        }
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (!users.isEmpty() && StringUtils.hasText(users.get(0).getFullName())) {
                return users.get(0).getFullName().trim();
            }
        } catch (Exception e) {
            log.debug("Could not resolve admin name for {}: {}", userId, e.getMessage());
        }
        return "Admin";
    }

    /** The admin's renewal price, else what the invoice charges. */
    private static BigDecimal renewalPriceOf(Claim claim, InvoiceProductLinkDTO link) {
        return link.getRenewalPrice() != null && link.getRenewalPrice().signum() > 0
                ? link.getRenewalPrice() : amountOf(claim);
    }

    private static BigDecimal amountOf(Claim claim) {
        return claim.totalAmount() != null ? claim.totalAmount() : BigDecimal.ZERO;
    }

    private static boolean isStale(String attemptedAt) {
        if (!StringUtils.hasText(attemptedAt)) {
            return true;
        }
        try {
            return LocalDateTime.parse(attemptedAt).isBefore(LocalDateTime.now().minusMinutes(STALE_CLAIM_MINUTES));
        } catch (Exception e) {
            return true;
        }
    }

    private static LocalDate parseDay(String value) {
        try {
            return LocalDate.parse(value.length() > 10 ? value.substring(0, 10) : value);
        } catch (Exception e) {
            throw new VacademyException("Invalid date: " + value + " (expected yyyy-MM-dd)");
        }
    }

    private static String blankToNull(String value) {
        return StringUtils.hasText(value) ? value : null;
    }

    private static String courseLabel(PackageSession ps) {
        if (ps == null) {
            return "Course";
        }
        String course = ps.getPackageEntity() != null ? ps.getPackageEntity().getPackageName() : null;
        String level = ps.getLevel() != null ? ps.getLevel().getLevelName() : null;
        String name = StringUtils.hasText(ps.getName()) ? ps.getName() : null;
        StringBuilder out = new StringBuilder(StringUtils.hasText(course) ? course : "Course");
        if (StringUtils.hasText(level) && !"DEFAULT".equalsIgnoreCase(level)) {
            out.append(" · ").append(level);
        }
        if (name != null) {
            out.append(" · ").append(name);
        }
        return out.toString();
    }

    private record Claim(boolean claimed, InvoiceProductLinkDTO link, String invoiceId, String instituteId, String userId,
                         String invoiceNumber, BigDecimal totalAmount, String currency) {
    }

    private record Outcome(boolean ok, String userPlanId, Date endDate, PaymentPlan pricePlan, String error) {
        static Outcome fulfilled(String userPlanId, Date endDate, PaymentPlan pricePlan) {
            return new Outcome(true, userPlanId, endDate, pricePlan, null);
        }

        static Outcome failed(String error) {
            return new Outcome(false, null, null, null, error);
        }
    }
}
