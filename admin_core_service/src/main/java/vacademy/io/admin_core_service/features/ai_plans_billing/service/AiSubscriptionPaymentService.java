package vacademy.io.admin_core_service.features.ai_plans_billing.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.AiPlansInternalClient;
import vacademy.io.admin_core_service.features.ai_plans_billing.client.ChargeView;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.PaymentLink;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.PaymentLinkRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RecurringDebit;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RecurringDebitRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RegistrationLink;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.PlatformRazorpayGateway.RegistrationLinkRequest;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.RazorpayDebitException;
import vacademy.io.admin_core_service.features.ai_plans_billing.gateway.RazorpayGatewayException;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore;
import vacademy.io.admin_core_service.features.ai_plans_billing.repository.AiSubscriptionMandateStore.Mandate;
import vacademy.io.admin_core_service.features.credits.dto.TaxBreakup;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver.BuyerTaxIdentity;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver.SaleKind;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformBillingProfile;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentStatus;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformBillingProfileRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.BrandModeService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.payment.enums.PaymentType;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * The money side of one subscription charge: price it from the buyer's frozen GST identity,
 * write the {@code platform_payment} + AI_SUBSCRIPTION item, and raise it on Razorpay as a hosted
 * Payment Link, an autopay registration link, or a recurring debit on an ACTIVE mandate.
 *
 * <p>Order of writes (money safety):
 * <ol>
 *   <li>The charge's tax / total / place-of-supply snapshot is PATCHed to ai_service BEFORE
 *       anything payable exists, so {@code /paid} always compares against what the link asks.</li>
 *   <li>The payment row is committed (INITIATED) in its own short transaction; Razorpay is called
 *       outside any transaction; a Razorpay failure flips the row to FAILED.</li>
 *   <li>Only one payable link per charge: an older open link is cancelled first, and if Razorpay
 *       says it was paid meanwhile, nothing new is created ({@link LinkOutcome#alreadyPaid}).</li>
 * </ol>
 * The fulfilment of a captured payment is the webhook's job (see {@code SubscriptionPaymentHandler}).
 */
@Slf4j
@Service
public class AiSubscriptionPaymentService {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    /** RBI: recurring debits above Rs 15,000 need additional authentication every time (owner D5). */
    public static final long AFA_FREE_MAX_MINOR = 1_500_000L;
    public static final String DEFAULT_SAC = "998315";
    /**
     * CGST Rule 46(e) (critique C): an invoice of Rs 50,000 or more to an unregistered buyer must
     * carry the buyer's name and address.
     */
    public static final long B2C_ADDRESS_THRESHOLD_MINOR = 5_000_000L;
    public static final String BUYER_ADDRESS_REQUIRED = "BUYER_ADDRESS_REQUIRED";
    public static final String NOTE_CHARGE_ID = "charge_id";
    public static final String NOTE_MANDATE_ID = "mandate_id";
    public static final String NOTE_PURPOSE = "purpose";
    static final String UPI = "UPI";
    /**
     * Without a {@code notification} object on the order, Razorpay sends the pre-debit notification
     * itself and debits later. UPI: "25 hours after the pre-debit notification is delivered", and
     * the payment "may take between 24-36 hours" to show
     * (https://razorpay.com/docs/api/payments/recurring-payments/upi/create-subsequent-payments/).
     * Cards: "If you do not pass this object, we will automatically try to debit after 36 hours and
     * 5 minutes" (https://razorpay.com/docs/api/payments/recurring-payments/cards/create-subsequent-payments/).
     * So a debit is raised {@link #DEBIT_CREATE_LEAD} before the service start (36 h 5 min + the
     * hourly job + margin) and looked at again {@link #DEBIT_SETTLE} after it was raised.
     */
    public static final Duration DEBIT_CREATE_LEAD = Duration.ofHours(40);
    static final Duration UPI_DEBIT_SETTLE = Duration.ofHours(37);
    static final Duration CARD_DEBIT_SETTLE = Duration.ofHours(37);
    /** When Razorpay is expected to debit after the recurring payment is created (what the notice says). */
    public static final Duration UPI_EXPECTED_DEBIT = Duration.ofHours(25);
    public static final Duration CARD_EXPECTED_DEBIT = Duration.ofHours(36).plusMinutes(5);
    /** First-purchase link lifetime (D14). */
    public static final Duration FIRST_PURCHASE_TTL = Duration.ofHours(48);
    /** An upgrade quote shrinks by the day: keep its link short (critique B). */
    public static final Duration UPGRADE_TTL = Duration.ofHours(2);
    /** Razorpay: expire_by at least 15 minutes ahead, at most six months after creation. */
    static final Duration MIN_LINK_LEAD = Duration.ofMinutes(20);
    static final Duration MAX_LINK_LIFE = Duration.ofDays(179);
    private static final DateTimeFormatter DMY = DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.ROOT);

    /** What a link request produced. */
    public record LinkOutcome(String platformPaymentId, String url, String linkId, Instant expiresAt,
            long totalMinor, boolean alreadyPaid, boolean reused) {}

    /** A priced charge: the breakup plus the buyer snapshot it was computed from. */
    public record Priced(TaxBreakup tax, PlatformBillingProfile profile, String sacCode, String description) {}

    private final AiPlansInternalClient client;
    private final PlatformRazorpayGateway gateway;
    private final PlatformPaymentRepository paymentRepository;
    private final PlatformPaymentItemRepository itemRepository;
    private final PlatformBillingProfileRepository profileRepository;
    private final PlatformPaymentConfigService configService;
    private final TaxResolver taxResolver;
    private final BrandModeService brandModeService;
    private final AiSubscriptionMandateStore mandates;
    private final InstituteRepository instituteRepository;
    private final TransactionTemplate tx;
    private final ObjectMapper mapper = new ObjectMapper();
    private Clock clock = Clock.systemUTC();

    public AiSubscriptionPaymentService(
            AiPlansInternalClient client,
            PlatformRazorpayGateway gateway,
            PlatformPaymentRepository paymentRepository,
            PlatformPaymentItemRepository itemRepository,
            PlatformBillingProfileRepository profileRepository,
            PlatformPaymentConfigService configService,
            TaxResolver taxResolver,
            BrandModeService brandModeService,
            AiSubscriptionMandateStore mandates,
            InstituteRepository instituteRepository,
            PlatformTransactionManager transactionManager) {
        this.client = client;
        this.gateway = gateway;
        this.paymentRepository = paymentRepository;
        this.itemRepository = itemRepository;
        this.profileRepository = profileRepository;
        this.configService = configService;
        this.taxResolver = taxResolver;
        this.brandModeService = brandModeService;
        this.mandates = mandates;
        this.instituteRepository = instituteRepository;
        this.tx = new TransactionTemplate(transactionManager);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** Tests. */
    void setClock(Clock clock) {
        this.clock = clock;
    }

    public Instant now() {
        return clock.instant();
    }

    // ── pricing ──────────────────────────────────────────────────────────

    /**
     * Prices a charge from the institute's billing profile. Subscriptions are INR, domestic, and
     * always need the buyer's state (422 BUYER_STATE_REQUIRED). Inclusive prices: base =
     * round(total / 1.18), tax = total - base (no 1 paisa drift).
     */
    public Priced price(ChargeView charge) {
        PlatformBillingProfile profile = profileRepository.findById(charge.instituteId()).orElse(null);
        if (profile == null || !StringUtils.hasText(profile.getStateCode()) && !StringUtils.hasText(profile.getGstin())) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY,
                    AiPlansBillingException.BUYER_STATE_REQUIRED,
                    "Add the billing state (GST place of supply) before paying for a plan");
        }
        PlatformPaymentConfig config = configService.load();
        // A tax-inclusive charge carries its list price as total_minor (ai_service: tax = total -
        // base); the GST is split out of that total, never added on top (critique #10).
        long amount = charge.baseMinor();
        if (charge.taxInclusive()) {
            Long inclusive = charge.totalMinor() != null ? charge.totalMinor() : charge.listPriceMinor();
            if (inclusive == null) {
                throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.UPSTREAM_ERROR,
                        "The tax-inclusive charge has no total");
            }
            amount = inclusive;
        }
        TaxBreakup tax;
        try {
            tax = taxResolver.resolveForBuyer(SaleKind.SUBSCRIPTION,
                    new BuyerTaxIdentity(profile.getStateCode(), profile.getGstin(), null),
                    charge.currency(), amount, charge.taxInclusive(), config.getSupplierStateCode(), true);
        } catch (TaxResolver.TaxException e) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY, e.getCode(), e.getMessage());
        }
        if (!StringUtils.hasText(profile.getGstin()) && tax.getTotalAmountMinor() >= B2C_ADDRESS_THRESHOLD_MINOR
                && (!StringUtils.hasText(profile.getLegalName()) || !StringUtils.hasText(profile.getAddress()))) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY, BUYER_ADDRESS_REQUIRED,
                    "Add the billing name and address: they must be on an invoice of Rs 50,000 or more");
        }
        if (StringUtils.hasText(profile.getGstin())) {
            // CGST Rule 46(e): a tax invoice to a registered buyer carries its name and address. A
            // profile seeded by a credit-pack top-up has GSTIN + state only: fall back to the
            // institute's own name / address (as the pack path does), else ask for them.
            profile = withInstituteFallback(profile, charge.instituteId());
            if (!StringUtils.hasText(profile.getLegalName()) || !StringUtils.hasText(profile.getAddress())) {
                throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY, BUYER_ADDRESS_REQUIRED,
                        "Add the billing name and address: they must be on a tax invoice to a GST-registered buyer");
            }
        }
        String sac = StringUtils.hasText(charge.sacCode()) ? charge.sacCode() : DEFAULT_SAC;
        return new Priced(tax, profile, sac, describe(charge));
    }

    /**
     * The profile as the invoice snapshot will see it: a missing legal name / address is taken from
     * the institute row (never saved back). A copy, so the stored profile is untouched.
     */
    PlatformBillingProfile withInstituteFallback(PlatformBillingProfile p, String instituteId) {
        if (StringUtils.hasText(p.getLegalName()) && StringUtils.hasText(p.getAddress())) {
            return p;
        }
        Institute inst = instituteId == null ? null : instituteRepository.findById(instituteId).orElse(null);
        if (inst == null) {
            return p;
        }
        PlatformBillingProfile c = new PlatformBillingProfile();
        c.setInstituteId(p.getInstituteId());
        c.setGstin(p.getGstin());
        c.setStateCode(p.getStateCode());
        c.setBillingEmail(p.getBillingEmail());
        c.setUpdatedBy(p.getUpdatedBy());
        c.setUpdatedAt(p.getUpdatedAt());
        c.setLegalName(StringUtils.hasText(p.getLegalName()) ? p.getLegalName() : inst.getInstituteName());
        String addr = StringUtils.hasText(p.getAddress()) ? p.getAddress()
                : vacademy.io.admin_core_service.features.credits.service.PlatformBillingProfileService
                        .buildInstituteAddress(inst);
        c.setAddress(StringUtils.hasText(addr) ? addr : null);
        return c;
    }

    /** "AI Pro subscription, 01-11-2026 to 30-11-2026" (IST dates, end exclusive). */
    public static String describe(ChargeView c) {
        if (StringUtils.hasText(c.description())) {
            return c.description().length() > 255 ? c.description().substring(0, 255) : c.description();
        }
        String name = StringUtils.hasText(c.planName()) ? c.planName() : "AI plan";
        String window = "";
        if (c.serviceStart() != null && c.serviceEnd() != null) {
            window = ", " + DMY.format(c.serviceStart().atZone(IST)) + " to "
                    + DMY.format(c.serviceEnd().minusSeconds(1).atZone(IST));
        }
        String text = (c.isUpgrade() ? "Upgrade to " + name : name + " subscription") + window;
        return text.length() > 255 ? text.substring(0, 255) : text;
    }

    /** Writes the tax snapshot onto the charge (ai_service checks /paid amounts against total_minor). */
    public void patchSnapshot(ChargeView charge, Priced p) {
        Map<String, Object> fields = new LinkedHashMap<>();
        if (charge.taxInclusive()) {
            fields.put("base_minor", p.tax().getBaseAmountMinor());
        }
        fields.put("tax_minor", p.tax().getTaxAmountMinor());
        fields.put("total_minor", p.tax().getTotalAmountMinor());
        fields.put("place_of_supply", p.tax().getPlaceOfSupply());
        fields.put("tax_head", TaxResolver.taxHeadOf(p.tax()).name());
        client.patchCharge(charge.id(), fields);
    }

    // ── platform_payment rows ────────────────────────────────────────────

    /** INITIATED payment + its AI_SUBSCRIPTION item, committed in one short transaction. */
    PlatformPayment createPaymentRow(ChargeView charge, Priced p, String buyerUserId, Map<String, Object> audit) {
        return createPaymentRow(charge, p, buyerUserId, audit, "RAZORPAY");
    }

    /**
     * An offline (bank transfer) payment for a charge: priced and snapshotted like any other,
     * vendor MANUAL so the invoice says "PAID (offline)". It is settled through the webhook
     * service's own fulfil path by the caller.
     */
    public PlatformPayment createManualPayment(ChargeView charge, Priced p, String actor, String reference) {
        return createPaymentRow(charge, p, actor, Map.of(NOTE_PURPOSE, "OFFLINE", "reference", reference), "MANUAL");
    }

    PlatformPayment createPaymentRow(ChargeView charge, Priced p, String buyerUserId, Map<String, Object> audit,
            String vendor) {
        BrandMode brand = brandModeService.resolve(charge.instituteId());
        return tx.execute(status -> {
            PlatformPayment pp = new PlatformPayment();
            pp.setInstituteId(charge.instituteId());
            pp.setBuyerUserId(buyerUserId);
            pp.setVendor(vendor);
            pp.setCurrency(charge.currency());
            pp.setBaseAmountMinor(p.tax().getBaseAmountMinor());
            pp.setTaxAmountMinor(p.tax().getTaxAmountMinor());
            pp.setTotalAmountMinor(p.tax().getTotalAmountMinor());
            pp.setStatus(PlatformPaymentStatus.INITIATED);
            pp.setPaymentStatus(PlatformPaymentResult.PAYMENT_PENDING);
            snapshotBuyer(pp, p, brand);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("snapshotKind", "ai_subscription_charge");
            data.put("chargeId", charge.id());
            data.put("subscriptionId", charge.subscriptionId());
            data.put("kind", charge.kind());
            data.put("planVersionId", charge.planVersionId());
            if (audit != null) {
                data.putAll(audit);
            }
            pp.setPaymentSpecificData(toJson(data));
            pp = paymentRepository.saveAndFlush(pp);

            PlatformPaymentItem item = new PlatformPaymentItem();
            item.setPlatformPaymentId(pp.getId());
            item.setItemKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
            item.setPackId(null);
            item.setPackCodeSnapshot(packCode(charge));
            item.setCredits(BigDecimal.ZERO);
            item.setCurrency(charge.currency());
            item.setBaseAmountMinor(p.tax().getBaseAmountMinor());
            item.setTaxRateBps(p.tax().getCgstRateBps() + p.tax().getSgstRateBps() + p.tax().getIgstRateBps());
            item.setTaxAmountMinor(p.tax().getTaxAmountMinor());
            item.setTotalAmountMinor(p.tax().getTotalAmountMinor());
            item.setHsnSacSnapshot(p.sacCode().length() > 8 ? p.sacCode().substring(0, 8) : p.sacCode());
            item.setSubscriptionChargeId(charge.id());
            item.setDescriptionSnapshot(p.description());
            item.setServicePeriodStart(charge.serviceStart());
            item.setServicePeriodEnd(charge.serviceEnd());
            itemRepository.save(item);
            return pp;
        });
    }

    static void snapshotBuyer(PlatformPayment pp, Priced p, BrandMode brand) {
        PlatformBillingProfile prof = p.profile();
        pp.setBuyerLegalName(prof.getLegalName());
        pp.setBuyerGstin(StringUtils.hasText(prof.getGstin()) ? prof.getGstin().trim().toUpperCase(Locale.ROOT) : null);
        pp.setBuyerStateCode(StringUtils.hasText(prof.getGstin()) ? prof.getGstin().trim().substring(0, 2)
                : prof.getStateCode());
        pp.setBuyerAddress(prof.getAddress());
        pp.setPlaceOfSupply(p.tax().getPlaceOfSupply());
        pp.setTaxHead(TaxResolver.taxHeadOf(p.tax()).name());
        pp.setBrandMode(brand.name());
    }

    static String packCode(ChargeView c) {
        String key = StringUtils.hasText(c.planKey()) ? c.planKey() : "plan";
        String code = "AI_SUB:" + key;
        return code.length() > 64 ? code.substring(0, 64) : code;
    }

    void markFailedSafe(String paymentId, String reason) {
        try {
            tx.executeWithoutResult(s -> paymentRepository.findById(paymentId).ifPresent(p -> {
                if (p.getPaymentStatus() == PlatformPaymentResult.PAYMENT_PENDING) {
                    p.setStatus(PlatformPaymentStatus.FAILED);
                    p.setPaymentStatus(PlatformPaymentResult.FAILED);
                    p.setPaymentSpecificData(mergeJson(p.getPaymentSpecificData(), Map.of("failure", reason)));
                    paymentRepository.save(p);
                }
            }));
        } catch (RuntimeException e) {
            log.error("[ai-plans-billing] could not mark platform_payment {} FAILED: {}", paymentId, e.getMessage());
        }
    }

    /** Marks an unpaid payment EXPIRED (its link expired or was cancelled). */
    public void markExpired(String paymentId) {
        tx.executeWithoutResult(s -> paymentRepository.findByIdForUpdate(paymentId).ifPresent(p -> {
            if (p.getPaymentStatus() == PlatformPaymentResult.PAYMENT_PENDING
                    || p.getPaymentStatus() == PlatformPaymentResult.FAILED) {
                p.setStatus(PlatformPaymentStatus.EXPIRED);
                p.setPaymentStatus(PlatformPaymentResult.EXPIRED);
                paymentRepository.save(p);
            }
        }));
    }

    // ── Payment Links ────────────────────────────────────────────────────

    /**
     * Raise (or reuse) the one payable link for a charge.
     *
     * @param expireBy when the link stops accepting money (first purchase: +48 h; upgrade: +2 h;
     *                 renewal: the grace end). Clamped to Razorpay's window.
     */
    public LinkOutcome createLinkForCharge(ChargeView charge, String returnUrl, Instant expireBy, String buyerUserId,
            String buyerEmail, String buyerContact) {
        if (!charge.isOpen()) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.CONFLICT,
                    "This charge is " + charge.status() + " and cannot be paid");
        }
        Instant now = now();
        // 1. Reuse an open link that stays valid for more than an hour.
        if (StringUtils.hasText(charge.paymentLinkId()) && StringUtils.hasText(charge.paymentLinkUrl())
                && charge.linkExpiresAt() != null && charge.linkExpiresAt().isAfter(now.plus(Duration.ofHours(1)))
                && StringUtils.hasText(charge.platformPaymentId())) {
            Optional<PlatformPayment> existing = paymentRepository.findById(charge.platformPaymentId());
            if (existing.isPresent() && isPayable(existing.get())) {
                return new LinkOutcome(existing.get().getId(), charge.paymentLinkUrl(), charge.paymentLinkId(),
                        charge.linkExpiresAt(), existing.get().getTotalAmountMinor(), false, true);
            }
        }
        // 2. Close the old link first: never two payable links for one charge.
        if (StringUtils.hasText(charge.paymentLinkId())) {
            if (closeLink(charge.paymentLinkId(), charge.platformPaymentId())) {
                return new LinkOutcome(charge.platformPaymentId(), null, charge.paymentLinkId(), null,
                        charge.totalMinor() == null ? 0L : charge.totalMinor(), true, false);
            }
        }
        // 3. Price, snapshot onto the charge, then the payment row.
        Priced p = price(charge);
        patchSnapshot(charge, p);
        PlatformPayment pp = createPaymentRow(charge, p, buyerUserId, Map.of(NOTE_PURPOSE, "LINK"));
        Instant expiry = clampExpiry(expireBy, now);

        Map<String, String> notes = baseNotes(pp, charge);
        notes.put(NOTE_PURPOSE, "LINK");
        String callback = callbackUrl(returnUrl, "plan_pp", pp.getId());
        PaymentLink link;
        try {
            link = gateway.createPaymentLink(new PaymentLinkRequest(
                    pp.getId(), p.tax().getTotalAmountMinor(), charge.currency(), p.description(),
                    p.profile().getLegalName(), firstText(buyerEmail, p.profile().getBillingEmail()),
                    buyerContact, expiry.getEpochSecond(), checkoutName(charge.instituteId()), callback, notes));
        } catch (RuntimeException e) {
            markFailedSafe(pp.getId(), "link_create_failed");
            throw e;
        }
        final String ppId = pp.getId();
        tx.executeWithoutResult(s -> paymentRepository.findById(ppId).ifPresent(row -> {
            row.setVendorOrderId(link.id());
            row.setLinkExpiresAt(expiry);
            paymentRepository.save(row);
        }));
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("platform_payment_id", ppId);
        patch.put("payment_link_id", link.id());
        patch.put("payment_link_url", link.shortUrl());
        patch.put("link_expires_at", expiry.toString());
        patch.put("status", "LINK_SENT");
        client.patchCharge(charge.id(), patch);
        return new LinkOutcome(ppId, link.shortUrl(), link.id(), expiry, p.tax().getTotalAmountMinor(), false, false);
    }

    /**
     * Cancels an open Payment Link. Returns true when Razorpay says the link was already PAID
     * (the caller then creates nothing; the webhook or reconcile fulfils it).
     */
    public boolean closeLink(String linkId, String platformPaymentId) {
        boolean registration = linkId.startsWith("inv_");
        try {
            PaymentLink cancelled = registration ? gateway.cancelRegistrationLink(linkId)
                    : gateway.cancelPaymentLink(linkId);
            if (cancelled.isPaid()) {
                return true;
            }
        } catch (RazorpayGatewayException e) {
            // Cancel fails on a paid or already-closed link: look before deciding.
            PaymentLink current = registration ? gateway.fetchRegistrationLink(linkId)
                    : gateway.fetchPaymentLink(linkId);
            if (current.isPaid()) {
                return true;
            }
            if (!current.isClosed()) {
                throw e;
            }
        }
        if (platformPaymentId != null) {
            markExpired(platformPaymentId);
        }
        return false;
    }

    static boolean isPayable(PlatformPayment p) {
        return p.getPaymentStatus() == PlatformPaymentResult.PAYMENT_PENDING
                || p.getPaymentStatus() == PlatformPaymentResult.FAILED;
    }

    // ── Autopay registration ─────────────────────────────────────────────

    /** Whether autopay may be offered for this amount (D5: within the AFA-free ceiling). */
    public static boolean autopayEligible(long totalMinor) {
        return totalMinor > 0 && totalMinor <= AFA_FREE_MAX_MINOR;
    }

    /**
     * A hosted registration link that registers the mandate AND pays this charge in the same
     * authorisation payment (amount = the charge total). The mandate is PENDING until
     * token.confirmed. The payment row's {@code vendor_order_id} is the registration's order id
     * so the webhook finds it even if notes are not copied onto the payment.
     *
     * @param method "UPI" or "CARD"
     */
    public LinkOutcome createRegistrationForCharge(ChargeView charge, String method, String returnUrl,
            Instant expireBy, String buyerUserId, String buyerName, String buyerEmail, String buyerContact) {
        Priced p = price(charge);
        long total = p.tax().getTotalAmountMinor();
        if (!autopayEligible(total)) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.AUTOPAY_UNAVAILABLE,
                    "Autopay is available only up to Rs 15,000 per payment");
        }
        String m = normaliseMethod(method);
        if (!UPI.equals(m)) {
            // Cards: the authorisation order amount "should be 100" (Rs 1)
            // (https://razorpay.com/docs/api/payments/recurring-payments/cards/create-authorization-transaction/),
            // so a card registration cannot also pay this charge. The charge is paid by link; card
            // autopay is set up separately (Rs 1, refunded: createStandaloneRegistration).
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.AUTOPAY_UNAVAILABLE,
                    "Card autopay is set up separately after the first payment");
        }
        String email = firstText(buyerEmail, p.profile().getBillingEmail());
        if (!StringUtils.hasText(email) || !StringUtils.hasText(buyerContact)) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY,
                    AiPlansBillingException.AUTOPAY_UNAVAILABLE,
                    "Autopay needs a billing email and a mobile number");
        }
        if (StringUtils.hasText(charge.paymentLinkId())
                && closeLink(charge.paymentLinkId(), charge.platformPaymentId())) {
            return new LinkOutcome(charge.platformPaymentId(), null, charge.paymentLinkId(), null, total, true, false);
        }
        patchSnapshot(charge, p);
        String name = firstText(p.profile().getLegalName(), buyerName, "Billing contact");
        String customerId = mandates.findCustomerIdForInstitute(charge.instituteId())
                .orElseGet(() -> gateway.createOrGetCustomer(name, email, buyerContact,
                        Map.of("institute_id", charge.instituteId())));
        String mandateId = mandates.insertPending(charge.instituteId(), charge.subscriptionId(), customerId,
                m, AFA_FREE_MAX_MINOR, "as_presented", buyerUserId);
        PlatformPayment pp = createPaymentRow(charge, p, buyerUserId,
                Map.of(NOTE_PURPOSE, "MANDATE_REGISTRATION", "mandateId", mandateId));
        Instant expiry = clampExpiry(expireBy, now());
        Map<String, String> notes = baseNotes(pp, charge);
        notes.put(NOTE_PURPOSE, "MANDATE_REGISTRATION");
        notes.put(NOTE_MANDATE_ID, mandateId);
        RegistrationLink link;
        try {
            link = gateway.createRegistrationLink(new RegistrationLinkRequest(
                    name, email, buyerContact, total, charge.currency(), p.description(),
                    m.toLowerCase(Locale.ROOT), AFA_FREE_MAX_MINOR, "as_presented", null,
                    expiry.getEpochSecond(), receipt(pp.getId()), notes));
        } catch (RuntimeException e) {
            markFailedSafe(pp.getId(), "registration_create_failed");
            mandates.updateStatus(mandateId, AiSubscriptionMandateStore.REJECTED, "registration link failed");
            throw e;
        }
        mandates.setRegistrationLink(mandateId, link.id(), link.shortUrl(), link.orderId());
        final String ppId = pp.getId();
        tx.executeWithoutResult(s -> paymentRepository.findById(ppId).ifPresent(row -> {
            row.setVendorOrderId(StringUtils.hasText(link.orderId()) ? link.orderId() : link.id());
            row.setLinkExpiresAt(expiry);
            paymentRepository.save(row);
        }));
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("platform_payment_id", ppId);
        patch.put("mandate_id", mandateId);
        // The registration link (inv_...) is this charge's one payable link: recorded so a later
        // link request cancels it first (closeLink handles both kinds).
        patch.put("payment_link_id", link.id());
        patch.put("link_expires_at", expiry.toString());
        patch.put("payment_link_url", link.shortUrl());
        patch.put("status", "LINK_SENT");
        client.patchCharge(charge.id(), patch);
        return new LinkOutcome(ppId, link.shortUrl(), link.id(), expiry, total, false, false);
    }

    /**
     * A registration with no charge to pay (autopay for future renewals): Rs 1 authorisation,
     * refunded automatically (the webhook treats it as LATE: refunded, never invoiced).
     */
    public LinkOutcome createStandaloneRegistration(String instituteId, String subscriptionId, String method,
            String buyerUserId, String buyerName, String buyerEmail, String buyerContact) {
        PlatformBillingProfile profile = profileRepository.findById(instituteId).orElse(null);
        String email = firstText(buyerEmail, profile == null ? null : profile.getBillingEmail());
        if (!StringUtils.hasText(email) || !StringUtils.hasText(buyerContact)) {
            throw new AiPlansBillingException(HttpStatus.UNPROCESSABLE_ENTITY,
                    AiPlansBillingException.AUTOPAY_UNAVAILABLE, "Autopay needs a billing email and a mobile number");
        }
        String m = normaliseMethod(method);
        String name = firstText(profile == null ? null : profile.getLegalName(), buyerName, "Billing contact");
        String customerId = mandates.findCustomerIdForInstitute(instituteId)
                .orElseGet(() -> gateway.createOrGetCustomer(name, email, buyerContact, Map.of("institute_id", instituteId)));
        String mandateId = mandates.insertPending(instituteId, subscriptionId, customerId, m, AFA_FREE_MAX_MINOR,
                "as_presented", buyerUserId);
        BrandMode brand = brandModeService.resolve(instituteId);
        PlatformPayment pp = tx.execute(s -> {
            PlatformPayment row = new PlatformPayment();
            row.setInstituteId(instituteId);
            row.setBuyerUserId(buyerUserId);
            row.setVendor("RAZORPAY");
            row.setCurrency("INR");
            row.setBaseAmountMinor(100L);
            row.setTaxAmountMinor(0L);
            row.setTotalAmountMinor(100L);
            row.setStatus(PlatformPaymentStatus.INITIATED);
            row.setPaymentStatus(PlatformPaymentResult.PAYMENT_PENDING);
            row.setBrandMode(brand.name());
            row.setPaymentSpecificData(toJson(Map.of("snapshotKind", "ai_subscription_mandate_auth",
                    "mandateId", mandateId, NOTE_PURPOSE, "MANDATE_AUTH")));
            row = paymentRepository.saveAndFlush(row);
            PlatformPaymentItem item = new PlatformPaymentItem();
            item.setPlatformPaymentId(row.getId());
            item.setItemKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
            item.setPackCodeSnapshot("AI_SUB:mandate");
            item.setCredits(BigDecimal.ZERO);
            item.setCurrency("INR");
            item.setBaseAmountMinor(100L);
            item.setTaxRateBps(0);
            item.setTaxAmountMinor(0L);
            item.setTotalAmountMinor(100L);
            item.setHsnSacSnapshot(DEFAULT_SAC);
            item.setDescriptionSnapshot("Autopay authorisation (refunded)");
            itemRepository.save(item);
            return row;
        });
        Map<String, String> notes = new LinkedHashMap<>();
        notes.put("orderId", pp.getId());
        notes.put("instituteId", instituteId);
        notes.put("payment_type", PaymentType.AI_SUBSCRIPTION.name());
        notes.put(NOTE_PURPOSE, "MANDATE_AUTH");
        notes.put(NOTE_MANDATE_ID, mandateId);
        Instant expiry = clampExpiry(now().plus(FIRST_PURCHASE_TTL), now());
        RegistrationLink link;
        try {
            link = gateway.createRegistrationLink(new RegistrationLinkRequest(name, email, buyerContact, 100L, "INR",
                    "Autopay set-up (Rs 1, refunded)", m.toLowerCase(Locale.ROOT), AFA_FREE_MAX_MINOR,
                    "as_presented", null, expiry.getEpochSecond(), receipt(pp.getId()), notes));
        } catch (RuntimeException e) {
            markFailedSafe(pp.getId(), "registration_create_failed");
            mandates.updateStatus(mandateId, AiSubscriptionMandateStore.REJECTED, "registration link failed");
            throw e;
        }
        mandates.setRegistrationLink(mandateId, link.id(), link.shortUrl(), link.orderId());
        final String ppId = pp.getId();
        tx.executeWithoutResult(s -> paymentRepository.findById(ppId).ifPresent(row -> {
            row.setVendorOrderId(StringUtils.hasText(link.orderId()) ? link.orderId() : link.id());
            row.setLinkExpiresAt(expiry);
            paymentRepository.save(row);
        }));
        return new LinkOutcome(ppId, link.shortUrl(), link.id(), expiry, 100L, false, false);
    }

    // ── Scheduled debit on an ACTIVE mandate ─────────────────────────────

    /** Nothing was raised at Razorpay (the claim on the charge failed): retry on the next pass. */
    public static class DebitNotRaisedException extends RuntimeException {
        public DebitNotRaisedException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /** Razorpay refused the debit before any payment existed: fall back to a payment link (D5). */
    public static class DebitRefusedException extends RuntimeException {
        public DebitRefusedException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Razorpay may have created the recurring payment (timeout / 5xx after the order). The charge
     * stays DEBIT_SCHEDULED on this payment: never send a link now; the webhook or the order
     * reconcile decides.
     */
    public static class DebitOutcomeUnknownException extends RuntimeException {
        public DebitOutcomeUnknownException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Raises the recurring debit for a renewal charge on its ACTIVE mandate.
     *
     * <p>Order (money safety): the payment row is written (INITIATED), then the debit is CLAIMED on
     * the charge in ai_service ({@code platform_payment_id}, DEBIT_SCHEDULED, {@code debit_attempts
     * + 1}) BEFORE Razorpay is called. From then on ai_service refuses any change that would void
     * or re-price the charge (DEBIT_IN_PROGRESS) and the next pass sees the debit in flight, so a
     * failure after Razorpay accepted the payment can never lead to a second debit or a link.
     *
     * @throws DebitNotRaisedException      the claim failed: nothing at Razorpay
     * @throws DebitRefusedException        Razorpay refused: no payment exists, the caller sends a link
     * @throws DebitOutcomeUnknownException a payment may exist: wait (webhook / reconcileOrder)
     */
    public LinkOutcome createDebit(ChargeView charge, Mandate mandate, String contact, String email) {
        Priced p = price(charge);
        long total = p.tax().getTotalAmountMinor();
        if (!mandate.isActive() || mandate.maxAmountMinor() != null && total > mandate.maxAmountMinor()
                || !autopayEligible(total)) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, AiPlansBillingException.AUTOPAY_UNAVAILABLE,
                    "The mandate cannot take this debit");
        }
        patchSnapshot(charge, p);
        PlatformPayment pp = createPaymentRow(charge, p, null,
                Map.of(NOTE_PURPOSE, "AUTOPAY_DEBIT", "mandateId", mandate.id()));
        final String ppId = pp.getId();

        // 1. Claim: the charge points at this debit before Razorpay knows about it.
        Instant recheck = now().plus(UPI.equals(mandate.method()) ? UPI_DEBIT_SETTLE : CARD_DEBIT_SETTLE);
        if (charge.preDebitNoticeSentAt() != null) {
            Instant floor = charge.preDebitNoticeSentAt().plus(Duration.ofHours(24));
            if (recheck.isBefore(floor)) {
                recheck = floor;
            }
        }
        Map<String, Object> claim = new LinkedHashMap<>();
        claim.put("platform_payment_id", ppId);
        claim.put("mandate_id", mandate.id());
        claim.put("status", "DEBIT_SCHEDULED");
        claim.put("debit_attempts", charge.debitAttempts() + 1);
        claim.put("next_attempt_at", recheck.toString());
        try {
            client.patchCharge(charge.id(), claim);
        } catch (RuntimeException e) {
            markFailedSafe(ppId, "debit_claim_failed");
            throw new DebitNotRaisedException("could not claim charge " + charge.id() + " for a debit: "
                    + e.getMessage(), e);
        }

        // 2. Razorpay.
        Map<String, String> notes = baseNotes(pp, charge);
        notes.put(NOTE_PURPOSE, "AUTOPAY_DEBIT");
        notes.put(NOTE_MANDATE_ID, mandate.id());
        RecurringDebit debit;
        try {
            debit = gateway.createRecurringDebit(new RecurringDebitRequest(total, charge.currency(),
                    receipt(pp.getId()), mandate.razorpayCustomerId(), mandate.tokenId(),
                    firstText(email, p.profile().getBillingEmail()), contact, p.description(), notes));
        } catch (RazorpayDebitException e) {
            if (e.paymentMayExist()) {
                saveOrderIdSafe(ppId, e.orderId());
                throw new DebitOutcomeUnknownException("debit for charge " + charge.id() + " may exist at Razorpay ("
                        + e.getMessage() + ")", e);
            }
            markFailedSafe(ppId, "debit_create_failed");
            throw new DebitRefusedException(e.getMessage(), e);
        } catch (RuntimeException e) {
            markFailedSafe(ppId, "debit_create_failed");
            throw new DebitRefusedException(e.getMessage(), e);
        }

        // 3. Bookkeeping; a failure here never means "refused" (the debit exists).
        if (!saveOrderIdSafe(ppId, debit.orderId())) {
            vacademy.io.common.logging.SentryLogger.logWarning(
                    "AI plan autopay debit raised but its order id was not saved; the webhook settles it",
                    Map.of("platform_payment_id", ppId, "order_id", String.valueOf(debit.orderId()),
                            "charge_id", charge.id()));
        }
        return new LinkOutcome(ppId, null, debit.orderId(), null, total, false, false);
    }

    boolean saveOrderIdSafe(String paymentId, String orderId) {
        if (orderId == null) {
            return false;
        }
        try {
            tx.executeWithoutResult(s -> paymentRepository.findById(paymentId).ifPresent(row -> {
                row.setVendorOrderId(orderId);
                paymentRepository.save(row);
            }));
            return true;
        } catch (RuntimeException e) {
            log.error("[ai-plans-billing] could not save order {} on platform_payment {}: {}", orderId, paymentId,
                    e.getMessage());
            return false;
        }
    }

    /**
     * A recurring debit was raised for this charge and has no outcome yet: the charge is
     * DEBIT_SCHEDULED and points at a PAYMENT_PENDING AUTOPAY_DEBIT payment. Paying by link,
     * marking paid offline, waiving or re-sending a link now would very likely collect twice.
     */
    public boolean debitInFlight(ChargeView c) {
        if (c == null || !"DEBIT_SCHEDULED".equalsIgnoreCase(c.status()) || !StringUtils.hasText(c.platformPaymentId())) {
            return false;
        }
        return paymentRepository.findById(c.platformPaymentId())
                .filter(p -> p.getPaymentStatus() == PlatformPaymentResult.PAYMENT_PENDING)
                .filter(p -> "AUTOPAY_DEBIT".equals(AiPlansInternalClient.Json.str(paymentData(p), NOTE_PURPOSE)))
                .isPresent();
    }

    /** 409 DEBIT_IN_PROGRESS when {@link #debitInFlight}. */
    public void requireNoDebitInFlight(ChargeView c) {
        if (debitInFlight(c)) {
            throw new AiPlansBillingException(HttpStatus.CONFLICT, DEBIT_IN_PROGRESS,
                    "An autopay debit for this payment is in progress");
        }
    }

    public static final String DEBIT_IN_PROGRESS = "DEBIT_IN_PROGRESS";

    // ── helpers ──────────────────────────────────────────────────────────

    Map<String, String> baseNotes(PlatformPayment pp, ChargeView charge) {
        Map<String, String> notes = new LinkedHashMap<>();
        // notes.orderId + payment_type: what PlatformRazorpayWebHookService routes on.
        notes.put("orderId", pp.getId());
        notes.put("instituteId", charge.instituteId());
        notes.put("payment_type", PaymentType.AI_SUBSCRIPTION.name());
        notes.put(NOTE_CHARGE_ID, charge.id());
        if (charge.subscriptionId() != null) {
            notes.put("subscription_id", charge.subscriptionId());
        }
        return notes;
    }

    /** The business name on Razorpay's hosted page: the trade name in VACADEMY mode, else the neutral name. */
    public String checkoutName(String instituteId) {
        PlatformPaymentConfig config = configService.load();
        BrandMode mode = brandModeService.resolve(instituteId);
        if (mode == BrandMode.VACADEMY && StringUtils.hasText(config.getTradeName())) {
            return config.getTradeName();
        }
        return StringUtils.hasText(config.getNeutralDisplayName()) ? config.getNeutralDisplayName()
                : config.getSupplierLegalName();
    }

    static Instant clampExpiry(Instant wanted, Instant now) {
        Instant min = now.plus(MIN_LINK_LEAD);
        Instant max = now.plus(MAX_LINK_LIFE);
        Instant e = wanted == null ? now.plus(FIRST_PURCHASE_TTL) : wanted;
        if (e.isBefore(min)) {
            e = min;
        }
        if (e.isAfter(max)) {
            e = max;
        }
        return e;
    }

    static String callbackUrl(String returnUrl, String param, String value) {
        if (!StringUtils.hasText(returnUrl)) {
            return null;
        }
        String base = returnUrl.trim();
        int hash = base.indexOf('#');
        String fragment = "";
        if (hash >= 0) {
            fragment = base.substring(hash);
            base = base.substring(0, hash);
        }
        return base + (base.contains("?") ? "&" : "?") + param + "=" + value + fragment;
    }

    static String receipt(String paymentId) {
        String r = "aisub_" + paymentId.replace("-", "");
        return r.length() > 40 ? r.substring(0, 40) : r;
    }

    static String normaliseMethod(String method) {
        String m = method == null ? "UPI" : method.trim().toUpperCase(Locale.ROOT);
        if (!"UPI".equals(m) && !"CARD".equals(m)) {
            throw AiPlansBillingException.invalid("Autopay method must be UPI or CARD");
        }
        return m;
    }

    /** The institute's phone number, used as the mandate contact when the caller has none. */
    public String instituteContact(String instituteId) {
        return instituteRepository.findById(instituteId).map(Institute::getMobileNumber)
                .filter(StringUtils::hasText).orElse(null);
    }

    static String firstText(String... values) {
        for (String v : values) {
            if (StringUtils.hasText(v)) {
                return v.trim();
            }
        }
        return null;
    }

    public String toJson(Map<String, Object> m) {
        try {
            return mapper.writeValueAsString(m);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }

    @SuppressWarnings("unchecked")
    public String mergeJson(String existing, Map<String, Object> extra) {
        Map<String, Object> m = new HashMap<>();
        if (StringUtils.hasText(existing)) {
            try {
                m.putAll(mapper.readValue(existing, Map.class));
            } catch (Exception ignored) {
                // keep only the new fields
            }
        }
        m.putAll(extra);
        return toJson(m);
    }

    /** Reads payment_specific_data as a map (empty on any error). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> paymentData(PlatformPayment p) {
        if (p == null || !StringUtils.hasText(p.getPaymentSpecificData())) {
            return new HashMap<>();
        }
        try {
            return mapper.readValue(p.getPaymentSpecificData(), Map.class);
        } catch (Exception e) {
            return new HashMap<>();
        }
    }
}
