package vacademy.io.admin_core_service.features.credits.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.credits.dto.BillingProfileDTO;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackDTO;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackOrderStatusDTO;
import vacademy.io.admin_core_service.features.credits.dto.CreditPackPurchaseResponseDTO;
import vacademy.io.admin_core_service.features.credits.dto.PlatformInvoiceSummaryDTO;
import vacademy.io.admin_core_service.features.credits.dto.TaxBreakup;
import vacademy.io.admin_core_service.features.credits.entity.CreditPack;
import vacademy.io.admin_core_service.features.credits.entity.CreditPackPrice;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackPriceRepository;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackRepository;
import vacademy.io.admin_core_service.features.credits.util.CurrencyResolver;
import vacademy.io.admin_core_service.features.credits.util.ReturnUrlPolicy;
import vacademy.io.admin_core_service.features.credits.util.TaxResolver;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.payments.manager.RazorpayPaymentManager;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentStatus;
import vacademy.io.admin_core_service.features.platform_billing.enums.TaxHead;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.BrandModeService;
import vacademy.io.admin_core_service.features.platform_billing.service.IndianStates;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformBillingFlags;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformInvoiceService;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformPaymentConfigService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.enums.PaymentGateway;
import vacademy.io.common.payment.enums.PaymentType;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Orchestrates the AI credit pack purchase flow on the Java side:
 *   - List packs in the institute's resolved currency with GST breakdown.
 *   - Create a platform_payment + Razorpay order for a pack.
 *   - Report fulfillment status to the polling frontend.
 *
 * Fulfillment itself is done in PlatformRazorpayWebHookService when
 * payment.captured arrives — this service does NOT grant credits or render
 * invoices.
 */
@Slf4j
@Service
public class CreditPackService {

    private final CreditPackRepository packRepository;
    private final CreditPackPriceRepository priceRepository;
    private final InstituteRepository instituteRepository;
    private final PlatformPaymentRepository platformPaymentRepository;
    private final PlatformPaymentItemRepository platformPaymentItemRepository;
    private final PlatformInvoiceRepository platformInvoiceRepository;
    private final PlatformPaymentConfigService configService;
    private final CurrencyResolver currencyResolver;
    private final TaxResolver taxResolver;
    private final RazorpayPaymentManager razorpayManager;
    private final PlatformInvoiceService platformInvoiceService;
    private final PlatformBillingProfileService billingProfileService;
    private final ReturnUrlPolicy returnUrlPolicy;
    private final PlatformBillingFlags billingFlags;
    private final BrandModeService brandModeService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Credit-pack Payment Links expire after 48 h (F7): an abandoned top-up can no longer be paid
     * days later, and the reconcile pass can close it as EXPIRED.
     */
    public static final Duration PACK_LINK_TTL = Duration.ofHours(48);
    /**
     * REQUIRES_NEW so each call gets its own short-lived TX, isolated from
     * any ambient TX the caller might have. We never want this inside a
     * larger TX that holds a connection across the Razorpay HTTP call.
     */
    private final TransactionTemplate txTemplate;

    public CreditPackService(
            CreditPackRepository packRepository,
            CreditPackPriceRepository priceRepository,
            InstituteRepository instituteRepository,
            PlatformPaymentRepository platformPaymentRepository,
            PlatformPaymentItemRepository platformPaymentItemRepository,
            PlatformInvoiceRepository platformInvoiceRepository,
            PlatformPaymentConfigService configService,
            CurrencyResolver currencyResolver,
            TaxResolver taxResolver,
            RazorpayPaymentManager razorpayManager,
            PlatformInvoiceService platformInvoiceService,
            PlatformBillingProfileService billingProfileService,
            ReturnUrlPolicy returnUrlPolicy,
            PlatformBillingFlags billingFlags,
            BrandModeService brandModeService,
            PlatformTransactionManager transactionManager) {
        this.packRepository = packRepository;
        this.priceRepository = priceRepository;
        this.instituteRepository = instituteRepository;
        this.platformPaymentRepository = platformPaymentRepository;
        this.platformPaymentItemRepository = platformPaymentItemRepository;
        this.platformInvoiceRepository = platformInvoiceRepository;
        this.configService = configService;
        this.currencyResolver = currencyResolver;
        this.taxResolver = taxResolver;
        this.razorpayManager = razorpayManager;
        this.platformInvoiceService = platformInvoiceService;
        this.billingProfileService = billingProfileService;
        this.returnUrlPolicy = returnUrlPolicy;
        this.billingFlags = billingFlags;
        this.brandModeService = brandModeService;
        this.txTemplate = new TransactionTemplate(transactionManager);
        this.txTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    // ─────────────────────────────────────────────────────────────────
    // Pack listing
    // ─────────────────────────────────────────────────────────────────

    public List<CreditPackDTO> listPacksForInstitute(String instituteId) {
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        String currency = currencyResolver.resolveCurrency(institute);
        String supplierStateCode = configService.load().getSupplierStateCode();
        Institute taxBuyer = withBuyerState(institute,
                billingProfileService.resolve(institute).stateCode());

        List<CreditPack> packs = packRepository.findByIsActiveTrueOrderByDisplayOrderAsc();
        List<CreditPackDTO> out = new ArrayList<>(packs.size());

        for (CreditPack pack : packs) {
            Optional<CreditPackPrice> priceOpt = priceRepository
                    .findByPackIdAndCurrencyAndIsActiveTrue(pack.getId(), currency);
            if (priceOpt.isEmpty()) {
                // Pack has no price in this currency — silently skip (admin
                // hasn't configured it yet for this region).
                continue;
            }
            CreditPackPrice price = priceOpt.get();

            // Treat the stored price as base (tax-exclusive) per V238 default.
            // If an admin later flips is_tax_inclusive, we'd back-derive base
            // here — out of scope until that flag is actually used.
            long baseMinor = price.getAmountMinor();
            TaxBreakup tax = taxResolver.resolveTax(taxBuyer, currency, baseMinor, supplierStateCode);

            int combinedTaxBps = tax.getCgstRateBps() + tax.getSgstRateBps() + tax.getIgstRateBps();

            out.add(CreditPackDTO.builder()
                    .packId(pack.getId())
                    .code(pack.getCode())
                    .name(pack.getName())
                    .credits(pack.getCredits())
                    .currency(currency)
                    .baseAmountMinor(tax.getBaseAmountMinor())
                    .taxAmountMinor(tax.getTaxAmountMinor())
                    .totalAmountMinor(tax.getTotalAmountMinor())
                    .taxRateBps(combinedTaxBps)
                    .displayPriceMajor(formatMajor(tax.getTotalAmountMinor(), currency))
                    .displayBaseMajor(formatMajor(tax.getBaseAmountMinor(), currency))
                    .displayTaxMajor(formatMajor(tax.getTaxAmountMinor(), currency))
                    .hsnSacCode(pack.getHsnSacCode())
                    .badge(pack.getBadge())
                    .isExport(tax.isExport())
                    .build());
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────────
    // Order creation
    //
    // Split into three phases so the slow Razorpay HTTP call is NOT held
    // inside a DB transaction — that would pin a connection from the pool
    // for the duration of the round-trip and choke us under load.
    //
    //   Phase A  — pure compute (validate, resolve currency + tax). No DB writes.
    //   Phase B  — TX1 (REQUIRES_NEW): persist platform_payment + items
    //              as INITIATED. Commits before we leave the method.
    //   Phase C  — Razorpay HTTP call. Outside any TX. If this throws, we
    //              flip the existing row to FAILED in TX-comp so it doesn't
    //              linger as INITIATED forever.
    //   Phase D  — TX2 (REQUIRES_NEW): patch vendor_order_id onto the row.
    //
    // Method is intentionally NOT @Transactional — we manage TX boundaries
    // explicitly via TransactionTemplate.
    // ─────────────────────────────────────────────────────────────────

    public CreditPackPurchaseResponseDTO createOrder(
            String instituteId, String packId, UserDTO buyer, String returnUrl) {
        return createOrder(instituteId, packId, buyer, returnUrl, null, null);
    }

    public CreditPackPurchaseResponseDTO createOrder(
            String instituteId, String packId, UserDTO buyer, String returnUrl,
            String buyerGstin, String buyerStateCode) {

        // ── Phase A: validate + compute (no DB writes) ──
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));

        // Persist the buyer's GST identity (platform_billing_profile, never the
        // institutes row) BEFORE tax is computed, then freeze it on the order (F4).
        billingProfileService.applyOrderFields(institute, buyerGstin, buyerStateCode,
                buyer != null ? buyer.getId() : null);
        PlatformBillingProfileService.BuyerIdentity buyerIdentity = billingProfileService.resolve(institute);

        CreditPack pack = packRepository.findById(packId)
                .orElseThrow(() -> new VacademyException("Pack not found: " + packId));
        if (Boolean.FALSE.equals(pack.getIsActive())) {
            throw new VacademyException("Pack is no longer available: " + pack.getCode());
        }

        // Re-resolve price server-side — never trust client-sent amount.
        String currency = currencyResolver.resolveCurrency(institute);
        CreditPackPrice price = priceRepository
                .findByPackIdAndCurrencyAndIsActiveTrue(packId, currency)
                .orElseThrow(() -> new VacademyException(
                        "No active price for pack " + pack.getCode() + " in " + currency));

        if (CurrencyResolver.INR.equalsIgnoreCase(currency) && buyerIdentity.stateCode() == null
                && billingFlags.buyerStateRequiredForPacks()) {
            throw new TaxResolver.TaxException(TaxResolver.BUYER_STATE_REQUIRED,
                    "Select your GST state before buying (place of supply, Circular 242/2024)");
        }

        PlatformPaymentConfig config = configService.load();
        // Legacy pack rule (unchanged amounts), fed the profile's state instead of institutes.state_code.
        TaxBreakup tax = taxResolver.resolveTax(
                withBuyerState(institute, buyerIdentity.stateCode()), currency, price.getAmountMinor(),
                config.getSupplierStateCode());
        String brandMode = brandModeService.resolve(instituteId).name();
        Instant linkExpiresAt = Instant.now().plus(PACK_LINK_TTL);

        // ── Phase B (TX1): persist initial order row + line item ──
        PlatformPayment payment = txTemplate.execute(status -> {
            PlatformPayment p = new PlatformPayment();
            p.setInstituteId(instituteId);
            p.setBuyerUserId(buyer != null ? buyer.getId() : null);
            p.setVendor(PaymentGateway.RAZORPAY.name());
            p.setCurrency(currency);
            p.setBaseAmountMinor(tax.getBaseAmountMinor());
            p.setTaxAmountMinor(tax.getTaxAmountMinor());
            p.setTotalAmountMinor(tax.getTotalAmountMinor());
            p.setStatus(PlatformPaymentStatus.INITIATED);
            p.setPaymentStatus(PlatformPaymentResult.PAYMENT_PENDING);
            p.setPaymentSpecificData(toJson(snapshotForAudit(pack, price, tax)));
            // Order-time snapshot: the invoice and any credit note read only these (critique #2).
            p.setBuyerLegalName(buyerIdentity.legalName());
            p.setBuyerGstin(buyerIdentity.gstin());
            p.setBuyerStateCode(buyerIdentity.stateCode());
            p.setBuyerAddress(buyerIdentity.address());
            p.setPlaceOfSupply(tax.getPlaceOfSupply());
            TaxHead head = TaxResolver.taxHeadOf(tax);
            p.setTaxHead(head == null ? null : head.name());
            p.setBrandMode(brandMode);
            p.setLinkExpiresAt(linkExpiresAt);
            p = platformPaymentRepository.saveAndFlush(p);

            PlatformPaymentItem item = new PlatformPaymentItem();
            item.setPlatformPaymentId(p.getId());
            item.setPackId(pack.getId());
            item.setPackCodeSnapshot(pack.getCode());
            item.setCredits(pack.getCredits());
            item.setCurrency(currency);
            item.setBaseAmountMinor(tax.getBaseAmountMinor());
            item.setTaxRateBps(tax.getCgstRateBps() + tax.getSgstRateBps() + tax.getIgstRateBps());
            item.setTaxAmountMinor(tax.getTaxAmountMinor());
            item.setTotalAmountMinor(tax.getTotalAmountMinor());
            item.setHsnSacSnapshot(pack.getHsnSacCode());
            item.setItemKind(PlatformPaymentItemKind.CREDIT_PACK);
            item.setDescriptionSnapshot(pack.getName() + " — "
                    + pack.getCredits().stripTrailingZeros().toPlainString() + " AI credits");
            platformPaymentItemRepository.save(item);
            return p;
        });

        // ── Phase C: Razorpay HTTP call — explicitly OUTSIDE any TX ──
        // convertAmountToPaise(double) inside the manager rounds *100 HALF_UP
        // back to paise — lossless for our amounts (< ₹10,000 / $100).
        PaymentInitiationRequestDTO razorpayReq = new PaymentInitiationRequestDTO();
        razorpayReq.setAmount(toMajor(tax.getTotalAmountMinor()));
        razorpayReq.setCurrency(currency);
        razorpayReq.setOrderId(payment.getId());     // becomes Razorpay receipt + notes.orderId
        razorpayReq.setInstituteId(instituteId);
        razorpayReq.setEmail(buyer != null ? buyer.getEmail() : null);
        razorpayReq.setVendor(PaymentGateway.RAZORPAY.name());
        razorpayReq.setPaymentType(PaymentType.AI_CREDIT_PACK);
        razorpayReq.setDescription(pack.getName() + " — " + pack.getCredits() + " AI credits");

        // Razorpay redirects the browser to this URL after the hosted payment.
        // We append our platform_payment_id so the returning page can resume
        // status polling. Payment happens on Razorpay's domain (always allowed) —
        // this is what lets the top-up work on custom white-labelled admin domains.
        // F8: only a Vacademy-owned host or one of this institute's own domains; anything
        // else gets no callback (the buyer still pays, on Razorpay's confirmation page).
        String allowedReturnUrl = returnUrlPolicy.sanitize(instituteId, returnUrl);
        String callbackUrl = null;
        if (allowedReturnUrl != null) {
            callbackUrl = allowedReturnUrl + (allowedReturnUrl.contains("?") ? "&" : "?")
                    + "topup_pp=" + payment.getId();
        }

        Map<String, Object> creds = configService.getRazorpayCredsMap();
        Map<String, Object> linkData;
        try {
            linkData = razorpayManager.createPaymentLink(buyer, razorpayReq, creds, callbackUrl,
                    RazorpayPaymentManager.PaymentLinkOptions.expiringAt(linkExpiresAt));
        } catch (RuntimeException e) {
            // Razorpay rejected / timed out. Flip the row to FAILED so it
            // doesn't sit at INITIATED forever, then propagate so the caller
            // sees a clear error.
            log.error("Razorpay payment link creation failed for platform_payment {}: {}",
                    payment.getId(), e.getMessage(), e);
            markFailedSafe(payment.getId());
            throw e;
        }

        String paymentLinkUrl = stringOrNull(linkData, "paymentLinkUrl");
        String paymentLinkId = stringOrNull(linkData, "paymentLinkId");
        String razorpayKeyId = stringOrNull(linkData, "razorpayKeyId");

        // ── Phase D (TX2): persist the link id for audit/trace ──
        // The webhook keys the grant on notes.orderId = platform_payment_id,
        // NOT on this — so a link with the same notes fulfills exactly as before.
        final String paymentId = payment.getId();
        txTemplate.executeWithoutResult(status ->
                platformPaymentRepository.findById(paymentId).ifPresent(p -> {
                    p.setVendorOrderId(paymentLinkId);
                    platformPaymentRepository.save(p);
                }));

        return CreditPackPurchaseResponseDTO.builder()
                .platformPaymentId(payment.getId())
                .paymentLinkUrl(paymentLinkUrl)
                .razorpayKeyId(razorpayKeyId)
                .amountMinor(tax.getTotalAmountMinor())
                .currency(currency)
                .packCode(pack.getCode())
                .displayPriceMajor(formatMajor(tax.getTotalAmountMinor(), currency))
                .build();
    }

    /**
     * Best-effort flip to FAILED after a failed Razorpay call. Wrapped so
     * the FAILED-write itself failing doesn't mask the original Razorpay error.
     */
    private void markFailedSafe(String paymentId) {
        try {
            txTemplate.executeWithoutResult(status ->
                    platformPaymentRepository.findById(paymentId).ifPresent(p -> {
                        p.setStatus(PlatformPaymentStatus.FAILED);
                        p.setPaymentStatus(PlatformPaymentResult.FAILED);
                        platformPaymentRepository.save(p);
                    }));
        } catch (RuntimeException e2) {
            log.error("Failed to mark platform_payment {} FAILED after Razorpay error: {}",
                    paymentId, e2.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Order status (polled by FE while waiting for webhook fulfillment)
    // ─────────────────────────────────────────────────────────────────

    public CreditPackOrderStatusDTO getOrderStatus(String platformPaymentId) {
        PlatformPayment payment = platformPaymentRepository.findById(platformPaymentId)
                .orElseThrow(() -> new VacademyException("Order not found: " + platformPaymentId));

        BigDecimal credits = null;
        if (payment.getPaymentStatus() == PlatformPaymentResult.PAID
                || payment.getPaymentStatus() == PlatformPaymentResult.PARTIALLY_REFUNDED
                || payment.getPaymentStatus() == PlatformPaymentResult.REFUNDED) {
            credits = platformPaymentItemRepository.findByPlatformPaymentId(platformPaymentId).stream()
                    .map(PlatformPaymentItem::getCredits)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
        }

        // Relative download path — the PDF is rendered on demand (no S3 copy).
        Optional<PlatformInvoice> invoiceOpt = platformInvoiceRepository.findByPlatformPaymentId(platformPaymentId);
        String invoiceUrl = invoiceOpt
                .map(inv -> "/admin-core-service/credits/packs/invoices/" + inv.getId() + "/pdf")
                .orElse(null);

        return CreditPackOrderStatusDTO.builder()
                .platformPaymentId(payment.getId())
                .status(payment.getStatus().name())
                .paymentStatus(payment.getPaymentStatus().name())
                .creditsGranted(credits)
                .invoiceUrl(invoiceUrl)
                .invoiceId(invoiceOpt.map(PlatformInvoice::getId).orElse(null))
                .invoiceNumber(invoiceOpt.map(PlatformInvoice::getInvoiceNumber).orElse(null))
                .build();
    }

    // ─────────────────────────────────────────────────────────────────
    // Billing profile (buyer GSTIN / state)
    // ─────────────────────────────────────────────────────────────────

    public BillingProfileDTO getBillingProfile(String instituteId) {
        Institute institute = instituteRepository.findById(instituteId)
                .orElseThrow(() -> new VacademyException("Institute not found: " + instituteId));
        PlatformBillingProfileService.BuyerIdentity id = billingProfileService.resolve(institute);
        boolean hasProfile = billingProfileService.find(instituteId) != null;
        return BillingProfileDTO.builder()
                .legalName(id.legalName() != null ? id.legalName() : institute.getInstituteName())
                .gstin(id.gstin())
                .stateCode(id.stateCode())
                .stateName(IndianStates.nameFor(id.stateCode()))
                // Before a profile exists this stays the raw institutes.address, as it always was.
                .address(hasProfile ? id.address() : institute.getAddress())
                .billingEmail(id.billingEmail())
                .currency(currencyResolver.resolveCurrency(institute))
                .build();
    }

    /**
     * Validate + persist the buyer's GSTIN / state code. Since V590 this writes
     * {@code platform_billing_profile} only (never {@code institutes.gstin / state_code},
     * which also drive the institute's own learner receipts). The institute is returned
     * unchanged.
     */
    public Institute saveBillingProfile(Institute institute, String gstinRaw, String stateCodeRaw) {
        billingProfileService.applyOrderFields(institute, gstinRaw, stateCodeRaw, null);
        return institute;
    }

    /** A detached copy carrying only what the legacy pack tax rule reads (the buyer state). */
    static Institute withBuyerState(Institute institute, String stateCode) {
        Institute copy = new Institute();
        copy.setId(institute == null ? null : institute.getId());
        copy.setStateCode(stateCode);
        return copy;
    }

    // ─────────────────────────────────────────────────────────────────
    // Invoice history
    // ─────────────────────────────────────────────────────────────────

    /**
     * All AI-credit invoices for an institute, newest first. PAID payments
     * that somehow have no invoice row (webhook-side generation failed, or
     * payments fulfilled before invoicing existed) are back-filled here so
     * historical purchases show up too.
     */
    public List<PlatformInvoiceSummaryDTO> listInvoices(String instituteId) {
        List<PlatformPayment> settled = platformPaymentRepository
                .findByInstituteIdAndPaymentStatusInOrderByCreatedAtDesc(instituteId, List.of(
                        PlatformPaymentResult.PAID,
                        PlatformPaymentResult.PARTIALLY_REFUNDED,
                        PlatformPaymentResult.REFUNDED));

        Map<String, PlatformPayment> byId = new HashMap<>();
        for (PlatformPayment p : settled) {
            byId.put(p.getId(), p);
        }

        List<PlatformInvoice> invoices = new ArrayList<>(
                platformInvoiceRepository.findByBuyerInstituteIdOrderByIssuedAtDesc(instituteId));
        java.util.Set<String> invoiced = new java.util.HashSet<>();
        for (PlatformInvoice inv : invoices) {
            invoiced.add(inv.getPlatformPaymentId());
        }
        for (PlatformPayment p : settled) {
            if (invoiced.contains(p.getId())) continue;
            // Never invoice a DUPLICATE / LATE payment (critique #7); subscription invoices are
            // issued by their own pipeline, not on a page read.
            if (!PlatformInvoiceService.isInvoiceable(p)) continue;
            if (!allCreditPack(platformPaymentItemRepository.findByPlatformPaymentId(p.getId()))) continue;
            try {
                PlatformInvoice generated = platformInvoiceService.generateInvoice(p.getId());
                invoices.add(generated);
                log.info("Back-filled invoice {} for platform_payment {}", generated.getInvoiceNumber(), p.getId());
            } catch (Exception e) {
                log.error("Invoice back-fill failed for platform_payment {}: {}", p.getId(), e.getMessage());
            }
        }
        invoices.sort((a, b) -> {
            if (a.getIssuedAt() == null || b.getIssuedAt() == null) return 0;
            return b.getIssuedAt().compareTo(a.getIssuedAt());
        });

        List<PlatformInvoiceSummaryDTO> out = new ArrayList<>(invoices.size());
        for (PlatformInvoice inv : invoices) {
            PlatformPayment payment = byId.get(inv.getPlatformPaymentId());
            List<PlatformPaymentItem> items =
                    platformPaymentItemRepository.findByPlatformPaymentId(inv.getPlatformPaymentId());
            BigDecimal credits = items.stream()
                    .map(PlatformPaymentItem::getCredits)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            String packName = lineName(items);
            long tax = nz(inv.getCgstAmountMinor()) + nz(inv.getSgstAmountMinor()) + nz(inv.getIgstAmountMinor());
            out.add(PlatformInvoiceSummaryDTO.builder()
                    .invoiceId(inv.getId())
                    .invoiceNumber(inv.getInvoiceNumber())
                    .platformPaymentId(inv.getPlatformPaymentId())
                    .issuedAt(inv.getIssuedAt())
                    .currency(inv.getCurrency())
                    .baseAmountMinor(inv.getBaseAmountMinor())
                    .taxAmountMinor(tax)
                    .totalAmountMinor(inv.getTotalAmountMinor())
                    .displayTotalMajor(formatMajor(nz(inv.getTotalAmountMinor()), inv.getCurrency()))
                    .credits(credits)
                    .packName(packName)
                    .paymentStatus(payment == null ? PlatformPaymentResult.PAID.name()
                            : payment.getPaymentStatus().name())
                    .isExport(inv.getIsExport())
                    .buyerGstin(inv.getBuyerGstin())
                    .build());
        }
        return out;
    }

    /**
     * The name shown for an invoice row. Pack items read the live pack name as before; a
     * pack-less item (AI_SUBSCRIPTION, pack_id NULL) uses its description snapshot (F2: this
     * used to call findById(null) and 500 the whole list).
     */
    String lineName(List<PlatformPaymentItem> items) {
        if (items == null || items.isEmpty()) {
            return "AI Credits";
        }
        PlatformPaymentItem first = items.get(0);
        if (first.getItemKind() == PlatformPaymentItemKind.AI_SUBSCRIPTION || first.getPackId() == null) {
            if (first.getDescriptionSnapshot() != null && !first.getDescriptionSnapshot().isBlank()) {
                return first.getDescriptionSnapshot();
            }
            return first.getPackCodeSnapshot() != null ? first.getPackCodeSnapshot() : "AI plan";
        }
        return packRepository.findById(first.getPackId())
                .map(CreditPack::getName)
                .orElse(first.getPackCodeSnapshot());
    }

    private static boolean allCreditPack(List<PlatformPaymentItem> items) {
        for (PlatformPaymentItem i : items) {
            if (i.getItemKind() == PlatformPaymentItemKind.AI_SUBSCRIPTION || i.getPackId() == null) {
                return false;
            }
        }
        return true;
    }

    private static long nz(Long v) {
        return v == null ? 0L : v;
    }

    // ─────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────

    private double toMajor(long amountMinor) {
        return amountMinor / 100.0;
    }

    private String formatMajor(long amountMinor, String currency) {
        double major = amountMinor / 100.0;
        // Use Locale.ROOT to avoid surprising thousands separators across regions;
        // FE can re-format if needed.
        NumberFormat nf = NumberFormat.getNumberInstance(Locale.ROOT);
        nf.setMinimumFractionDigits(2);
        nf.setMaximumFractionDigits(2);
        String symbol = "INR".equalsIgnoreCase(currency) ? "₹" : "USD".equalsIgnoreCase(currency) ? "$" : "";
        return symbol + nf.format(major);
    }

    private Map<String, Object> snapshotForAudit(CreditPack pack, CreditPackPrice price, TaxBreakup tax) {
        Map<String, Object> m = new HashMap<>();
        m.put("snapshotKind", "pack_purchase");
        m.put("packCode", pack.getCode());
        m.put("packCredits", pack.getCredits());
        m.put("priceMinor", price.getAmountMinor());
        m.put("currency", price.getCurrency());
        m.put("taxAmountMinor", tax.getTaxAmountMinor());
        m.put("totalAmountMinor", tax.getTotalAmountMinor());
        m.put("placeOfSupply", tax.getPlaceOfSupply());
        m.put("isExport", tax.isExport());
        // a single id we can correlate with logs if support needs it
        m.put("auditCorrelationId", UUID.randomUUID().toString());
        return m;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize payment_specific_data: {}", e.getMessage());
            return "{}";
        }
    }

    private static String stringOrNull(Map<String, Object> map, String key) {
        Object v = map == null ? null : map.get(key);
        return v == null ? null : v.toString();
    }
}
